// アンケートの取り込み・分析・書き戻しのテスト（APIを使わない）：npm run test:surveys
// 本物の Agent の代わりに、キーワードで文を分ける偽の analyzer を使う。
// data/cards.json は書き戻しで変わるので、終わったらバイトごと元に戻す。分析結果と取り込みは一時ファイルに書く。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "survey-test-"));
process.env.SURVEY_ANALYSIS_FILE = path.join(TMP, "analysis.json");
process.env.SURVEY_IMPORT_DIR = path.join(TMP, "imports");
process.env.TALK_RECORD_FILE = path.join(TMP, "talk_records.json");

import { loadCards, patchCard } from "../lib/cards";
import { events } from "../lib/data";
import { internalTerms } from "../lib/plainText";
import { detectColumns, importSurveyCsv, loadImport, parseCsv, saveImport, surveys, type ColumnAsker } from "../lib/surveyCsv";
import {
  analyzeEvent,
  eventOverview,
  eventStats,
  eventDetail,
  loadTalkRecords,
  overviewProblems,
  talkFeedback,
  talkRecordProblems,
  cardLeakProblems,
  contentFact,
  eventMessage,
  reactionLines,
  resolveReaction,
  sentencesOf,
  validateAnalysis,
  type AnalysisInput,
  type Analyzer,
  type SurveyEvent,
} from "../lib/surveys";
import { getCard } from "../lib/tools";

const CARDS = path.join(process.cwd(), "data", "cards.json");
const original = fs.readFileSync(CARDS);
const csvOf = (ev: string) => fs.readFileSync(path.join(process.cwd(), "data", "surveys", `${ev}.csv`), "utf-8");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

// ---- 偽の AI：キーワードで文を分ける（本番は Claude）
const BAD = /駆け足|難し|ついていけ|寒|聞き取りにく|遅れ|途切れ|下手|やる気|文字が小さく|速くて|抽象的|分からなかった|共有されて|ほしかった|知りたかった|ほしいです|足りな|浅くて|追いつ/;
const OPS = /寒|マイク|遅れ|配信|質疑/;
const ATTACK = /下手すぎ|やる気が感じられず/;
const OTHER = /ピザ|懇親会|受付|次回も参加/;
const OVERLAP: Record<string, string> = {
  "エージェントの回帰テストをCIで回す方法": "card-e013-01",
  "LLMの出力を自動で評価する仕組み": "card-e013-01",
  "改ざんを検知できる監査ログの作り方": "card-e023-01",
  "flakyなE2Eテストの原因の切り分け方": "card-e020-01",
  "夜間のオンコール呼び出しを減らした話": "card-e016-01",
};
function fakeInput(eventId: string): AnalysisInput {
  const all = surveys();
  const sents = sentencesOf(eventId, all);
  const sentences = sents.map((s) => {
    if (OTHER.test(s.text)) return { id: s.id, polarity: "good" as const, topic: "operation" as const, attack: false }; // イベント全体の良い点
    if (BAD.test(s.text)) return { id: s.id, polarity: "bad" as const, topic: OPS.test(s.text) ? ("operation" as const) : ("content" as const), attack: ATTACK.test(s.text) };
    return { id: s.id, polarity: "good" as const, topic: "content" as const, attack: false };
  });
  const speakers = [...new Set(all.filter((a) => a.event_id === eventId).map((a) => a.talk_speaker_id))];
  const positive_themes: AnalysisInput["positive_themes"] = speakers
    .map((sp) => {
      const ids = sentences.filter((l) => l.polarity === "good" && l.topic === "content" && sents.find((s) => s.id === l.id)!.speaker_id === sp).map((l) => l.id);
      return { speaker_id: sp as string | null, theme: "話の中身が参考になった", sentence_ids: ids, representative_ids: ids.slice(0, 1) };
    })
    .filter((t) => t.sentence_ids.length);
  const eventWide = sentences.filter((l) => l.polarity === "good" && l.topic === "operation").map((l) => l.id);
  if (eventWide.length) positive_themes.push({ speaker_id: null, theme: "懇親会や受付など運営がよかった", sentence_ids: eventWide, representative_ids: eventWide.slice(0, 1) });
  const talks = speakers.map((sp) => {
    const content = sentences.some((l) => l.polarity === "bad" && l.topic === "content" && !l.attack && sents.find((s) => s.id === l.id)!.speaker_id === sp);
    const wants = new Map<string, string[]>();
    for (const a of all.filter((x) => x.event_id === eventId && x.talk_speaker_id === sp && x.want_next)) wants.set(a.want_next!, [...(wants.get(a.want_next!) ?? []), a.id]);
    return {
      speaker_id: sp,
      summary: "具体的な話が好評だった",
      content_issue: content ? "話の分かりにくさ" : null,
      next_themes: [...wants.entries()].map(([text, ids]) => ({ text, response_ids: ids, overlaps_card_id: OVERLAP[text] ?? null })),
    };
  });
  return { sentences, positive_themes, talks };
}
function fake(answers: AnalysisInput[]): Analyzer {
  let i = 0;
  return async () => ({ input: answers[Math.min(i++, answers.length - 1)], content: [], tool_use_id: `t${i}`, model: "test" });
}

async function main() {
  try {
    // ---------------------------------------------------------------- CSV
    const t = parseCsv('﻿タイムスタンプ,感想\r\n2026/09/11 21:00:00,"カンマ, と ""引用"" と\n改行"\r\n');
    check("CSV：BOM・引用符・セル内の改行・カンマを読む", t.length === 2 && t[1][1] === 'カンマ, と "引用" と\n改行');
    const headers = parseCsv(csvOf("ev020"))[0];
    const cols = detectColumns(headers);
    const roleOf = (h: RegExp) => cols.find((c) => h.test(c.header))?.role;
    check(
      "列の意味を質問文のキーワードで決める",
      roleOf(/タイムスタンプ/) === "timestamp" && roleOf(/どの登壇/) === "talk" && roleOf(/満足度/) === "rating" && roleOf(/感想/) === "comment" && roleOf(/次に聞きたい/) === "want_next" && roleOf(/職種/) === "role",
    );
    check("メール・名前の列は個人情報", roleOf(/メール/) === "personal" && roleOf(/お名前/) === "personal");
    check("キーワードのない列は読み取れない列", roleOf(/何で知りました/) === "unread");

    const asked: Array<{ header: string; samples: string[] }> = [];
    const asker: ColumnAsker = async (cs) => {
      asked.push(...cs);
      return cs.map((c) => ({ index: c.index, role: "unread" }));
    };
    const imp = await importSurveyCsv("ev020", csvOf("ev020"), { source: "upload", asker });
    check("決まらない列だけを Agent に聞く", imp.ok && asked.length === 1 && /何で知りました/.test(asked[0].header), asked.map((a) => a.header).join(","));
    check("Agent に個人情報を渡さない", !JSON.stringify(asked).includes("@") && !/山田|佐藤|高橋|伊藤|渡辺|中村|小林|加藤/.test(JSON.stringify(asked)));
    if (imp.ok) {
      const dump = JSON.stringify(imp.data);
      check("取り込んだ回答にメールアドレス・名前が残らない", !dump.includes("@example.com") && !/山田 花子|佐藤 健|高橋 美咲|伊藤 大輔|渡辺 さくら|中村 翔|小林 結衣|加藤 直樹/.test(dump));
      const rows = parseCsv(csvOf("ev020"));
      const r = imp.data.answers.find((x) => x.id === "ev020-r5")!;
      check("回答のidは行番号から（2行目が最初の回答）", imp.data.answers[0].id === "ev020-r2" && !!r && r.comment === rows[4][headers.findIndex((h) => /感想/.test(h))].trim());
      saveImport(imp.data);
      check("取り込んだものを優先して読む", loadImport("ev020")?.source === "upload");
      fs.rmSync(path.join(TMP, "imports", "ev020.json"));
      check("取り込みがなければ架空データのCSVを読む", loadImport("ev020")?.source === "sample");
    }
    const noTalk = await importSurveyCsv("ev019", "タイムスタンプ,満足度,感想\n2026/09/11 21:00:00,5,よかった\n", { source: "upload", asker: null });
    check("登壇が2つのイベントで「どの登壇か」の列がない回答は、どの登壇か分からない回答にする", noTalk.ok && noTalk.data.unmatched_rows.length === 1 && noTalk.data.answers.length === 0);
    const single = await importSurveyCsv("ev016", "タイムスタンプ,満足度,感想\n2026/05/15 21:00:00,4,よかった\n", { source: "upload", asker: null });
    check("登壇が1つのイベントはその登壇への回答にする", single.ok && single.data.answers[0]?.talk_speaker_id === "e001");
    const scrub = await importSurveyCsv("ev016", "タイムスタンプ,満足度,感想\n2026/05/15 21:00:00,4,連絡は foo@example.com か 090-1234-5678 まで\n", { source: "upload", asker: null });
    check("自由記述の中のメール・電話番号は伏せる", scrub.ok && !scrub.data.answers[0].comment.includes("@") && !scrub.data.answers[0].comment.includes("090"));

    // ---------------------------------------------------------------- 集計（コード）
    const all = surveys();
    // イベント単位の集計（登壇者には結びつけない）
    const rows19 = parseCsv(csvOf("ev019")).slice(1);
    const st = eventStats("ev019");
    const avg = Math.round((rows19.reduce((a, r) => a + Number(r[3]), 0) / rows19.length) * 10) / 10;
    check("回答数・全体の満足度の平均が CSV と一致", st.answers === rows19.length && st.overall_rating?.average === avg, `${st.answers}件・平均${st.overall_rating?.average}`);
    check("分布の合計が満足度のある回答数と一致", st.overall_rating!.distribution.reduce((a, b) => a + b, 0) === st.overall_rating!.rated);
    check("空欄・「特になし」の回答は除外して数える", st.excluded === rows19.filter((r) => ["", "なし", "特になし"].includes(r[4].trim()) && !r[5].trim()).length);
    // 画面の窓口：登壇者は「誰が何を話したか」だけ（タイトルはアンケートの「どの登壇か」の列からコードで取り出す）
    const det = eventDetail("ev019")!;
    check("窓口は event・overview・speakers・source だけ（古い登壇者ごとの項目はない）", Object.keys(det).sort().join(",") === "event,overview,source,speakers", Object.keys(det).join(","));
    check("登壇者は名前とタイトルだけ", det.speakers.every((sp) => Object.keys(sp).sort().join(",") === "business_unit,name,title") && det.speakers.some((sp) => sp.title === "AIエージェントの本番運用で効くガードレール設計"), det.speakers.map((sp) => `${sp.name}「${sp.title}」`).join(" / "));
    const mixed = sentencesOf("ev019").filter((s) => s.answer_id === all.find((a) => a.comment.startsWith("内容はとても良かったです。ただ"))?.id);
    check("1つの回答を文に分ける（良い点と不満が混ざる回答）", mixed.length === 2, mixed.map((m) => m.text).join(" / "));

    // ---------------------------------------------------------------- AI に渡すもの
    const msg = eventMessage(events().find((e) => e.id === "ev019")!);
    const n003 = all.filter((x) => x.event_id === "ev019" && x.talk_speaker_id === "e003").length; // 久住さんの登壇への回答数
    check("AI に CSV 全体・個人情報を渡さない", !msg.includes("@") && !/2026\/09\/11 \d/.test(msg) && !/山田 花子|佐藤 健/.test(msg) && !msg.includes("どの登壇についての回答ですか"));
    check("AI に集計結果と自由記述を渡す", msg.includes(`回答${n003}件・感想あり`) && mixed.every((m) => msg.includes(`${m.id}｜${m.text}`)));
    check("AI に渡す登壇ごとの集計に全体の満足度を入れない", !/満足度の平均|この登壇の点数/.test(msg), "全体の満足度しかないアンケートなので、登壇ごとの点数はなし");

    // ---- 全体の満足度は登壇者に結びつけない。登壇ごとの点数の列があるときだけ使う
    check("全体の満足度の列は「全体」、登壇の点数の列は「登壇ごと」と見分ける",
      detectColumns(["タイムスタンプ", "満足度を教えてください", "この登壇の満足度", "感想"]).map((c) => c.scope ?? "-").join(",") === "-,overall,talk,-");
    const fb = talkFeedback("ev019").find((t) => t.speaker_id === "e003")!;
    check("全体の満足度しかないとき、登壇者ごとの点数は作らない", fb.talk_rating === null && fb.count === n003);
    const es = eventStats("ev019");
    check("全体の満足度はイベント単位の集計にだけ使う", es.overall_rating?.rated === all.filter((s) => s.event_id === "ev019" && s.rating).length && es.answers === all.filter((s) => s.event_id === "ev019").length);
    const twoCols = await importSurveyCsv(
      "ev019",
      "タイムスタンプ,どの登壇についての回答ですか？,満足度を教えてください,この登壇の満足度を教えてください,感想\n" +
        "2026/09/11 21:00:00,久住 拓真「ガードレール」,2,5,とても良かった\n2026/09/11 21:01:00,久住 拓真「ガードレール」,1,4,参考になった\n",
      { source: "upload", asker: null },
    );
    check("登壇ごとの点数の列があるときは、その点数だけを登壇者の参考に使う",
      twoCols.ok && twoCols.data.answers.every((x) => x.rating! <= 2 && x.talk_rating! >= 4) &&
      talkFeedback("ev019", twoCols.ok ? twoCols.data.answers : []).find((t) => t.speaker_id === "e003")?.talk_rating?.average === 4.5);

    // ---------------------------------------------------------------- 検証
    const good = fakeInput("ev020");
    check("正しい読み取り結果は通る", validateAnalysis("ev020", good).length === 0, validateAnalysis("ev020", good).slice(0, 3).join(" / "));
    const bad = (mut: (x: AnalysisInput) => void) => {
      const x = fakeInput("ev020");
      mut(x);
      return validateAnalysis("ev020", x);
    };
    check("分類していない文があると弾く", bad((x) => x.sentences.pop()).some((e) => e.includes("分類していない")));
    check("不満に運営か内容かがないと弾く", bad((x) => (x.sentences.find((l) => l.polarity === "bad")!.topic = null)).some((e) => e.includes("運営か内容か")));
    check("良い点のテーマに不満の文を入れると弾く", bad((x) => x.positive_themes[0].sentence_ids.push(x.sentences.find((l) => l.polarity === "bad")!.id)).some((e) => e.includes("良い点に分けていません")));
    check("良い点の文をテーマに入れ忘れると弾く", bad((x) => x.positive_themes[0].sentence_ids.pop()).some((e) => e.includes("テーマに入れていない")));
    check(
      "イベント全体の良い点を登壇のテーマに入れると弾く",
      bad((x) => {
        const ev = x.positive_themes.find((p) => p.speaker_id === null)!;
        x.positive_themes[0].sentence_ids.push(ev.sentence_ids.pop()!);
      }).some((e) => e.includes("イベント全体の良い点")),
    );
    const attackText = sentencesOf("ev020").find((s) => /下手すぎ/.test(s.text))!.text;
    check("反応のまとめに攻撃の言葉が入ると弾く", bad((x) => (x.talks[0].summary = attackText)).some((e) => e.includes("攻撃")));
    const complaint = sentencesOf("ev020").find((s) => /前提知識/.test(s.text))!.text;
    check("内容への不満の一言に原文を写すと弾く", bad((x) => (x.talks.find((t) => t.content_issue)!.content_issue = complaint.slice(0, 25))).some((e) => e.includes("原文")));
    check("数字を書くと弾く", bad((x) => (x.talks[0].summary = "平均3.0で不満が5件")).some((e) => e.includes("数字")));
    check("内部の言葉を書くと弾く", bad((x) => (x.talks[0].summary = "reviewed=false のカード")).some((e) => e.includes("内部")));
    check("本人のカードとの重なりは弾く", bad((x) => (x.talks.find((t) => t.next_themes.length)!.next_themes[0].overlaps_card_id = `card-${x.talks.find((t) => t.next_themes.length)!.speaker_id}-01`)).some((e) => e.includes("本人のカード")));

    // ---------------------------------------------------------------- 分析 → 差し戻し → 画面 → 書き戻し
    const log: SurveyEvent[] = [];
    const wrong = fakeInput("ev020");
    wrong.sentences.pop();
    const a = await analyzeEvent("ev020", (e) => log.push(e), { analyzer: fake([wrong, fakeInput("ev020")]) });
    check("1回目は差し戻し、2回目で通る", !!a && log.filter((e) => e.type === "rejected").length === 1);
    if (!a) throw new Error("分析できませんでした");
    const badIds = a.labels.filter((l) => l.polarity === "bad").map((l) => l.id);
    const shownIds = [...a.negatives.operation, ...a.negatives.content].flatMap((n) => n.sentence_ids);
    check("不満に分けた文が全部、画面の一覧に出る", badIds.every((id) => shownIds.includes(id)) && shownIds.length === badIds.length, `${badIds.length}文`);
    const sMap = new Map(sentencesOf("ev020").map((s) => [s.id, s.text]));
    check("不満は原文のまま（言い回しを変えない）", [...a.negatives.operation, ...a.negatives.content].every((n) => n.sentence_ids.every((id) => sMap.get(id) === n.text)));
    check("運営と内容に分ける", a.negatives.operation.length > 0 && a.negatives.content.length > 0);
    check("攻撃の言葉も画面には出す（印つき）", [...a.negatives.operation, ...a.negatives.content].some((n) => n.attack && n.text === attackText));
    check("ポジティブはテーマごとに件数と代表の声", a.positives.every((p) => p.count > 0 && p.representatives.length >= 1 && p.representatives.length <= 2));
    const evWide = a.positives.filter((p) => p.speaker_id === null);
    check("懇親会・受付などはイベント全体の良い点として分ける", evWide.length === 1 && evWide[0].representatives.every((r) => OTHER.test(r.text)));

    // ---- 登壇者の記録は内部だけ（カードには書かない）。内容のことだけで、運営・会場・設備は入れない
    const rec = loadTalkRecords().find((r) => r.speaker_id === "e004" && r.event_id === "ev020");
    const t4 = a.talks.find((x) => x.speaker_id === "e004")!;
    check("登壇者の反応はカードに書かない", loadCards().every((c) => !(c.reactions ?? []).some((r) => r.kind === "reception")));
    check("登壇者の記録（内部）には内容への不満の事実だけ", rec?.content_fact === contentFact(t4) && /^前回は.+を指摘する声が\d+件$/.test(rec?.content_fact ?? ""), rec?.content_fact ?? "");
    check("登壇者の記録に全体の満足度を入れない", rec?.talk_average === null && !JSON.stringify(rec).includes("満足度"));
    const opsTexts = a.negatives.operation.map((n) => n.text);
    check("会場・運営への不満は登壇者の記録に入らない", opsTexts.length > 0 && talkRecordProblems(a).length === 0 && !opsTexts.some((t) => JSON.stringify(loadTalkRecords()).includes(t.slice(0, 8))));
    check("イベント全体の良い点は登壇者の記録とカードに入れない", !JSON.stringify(loadTalkRecords()).includes(evWide[0].theme) && !JSON.stringify(loadCards().flatMap((c) => c.reactions ?? [])).includes(evWide[0].theme));
    check("カードに不満の原文・攻撃の言葉が入らない", cardLeakProblems(a).length === 0 && !JSON.stringify(loadCards().flatMap((c) => c.reactions ?? [])).includes(attackText));
    const leaky = fakeInput("ev020");
    leaky.talks.find((t) => t.speaker_id === "e004")!.summary = "会場が寒くて集中しにくかった";
    check("登壇者のまとめに運営・会場のことを書くと弾く", validateAnalysis("ev020", leaky).some((e) => e.includes("運営・会場・設備")));
    const forged = { ...rec!, id: "tr-x", talk_average: 2.8, summary: "会場が寒かった" };
    const flagged = talkRecordProblems(a, [forged]);
    check("記録に全体の満足度や会場の不満が入れば検査で落ちる", flagged.some((e) => e.includes("点数")) && flagged.some((e) => e.includes("運営・会場・設備")));

    // ---- 画面用の窓口（イベント単位の集計）に登壇者ごとの評価が出ない
    const ov = eventOverview("ev020")!;
    check("画面用の窓口はイベント単位の集計だけ", overviewProblems(ov).length === 0 && !!ov.analysis && ov.stats.talks === 2, overviewProblems(ov).join(" / "));
    check("画面用の窓口に登壇者の名前・点数・まとめが出ない", !/相良|青柳|talk_rating|content_fact|summary/.test(JSON.stringify(ov)));
    check("窓口の検査は、登壇者ごとの項目が入ると落ちる", overviewProblems({ ...ov, stats: { ...ov.stats, ...({ speaker_id: "e004" } as object) } } as typeof ov).length > 0);

    // ---- 需要あり（別の社員のカード）は今までどおり提案
    const dm = loadCards().find((c) => c.card_id === "card-e023-01")!.reactions?.find((r) => r.kind === "demand");
    check("重なるテーマは別の社員のカードに「需要あり」の提案", dm?.status === "pending" && dm.from_speaker_id === "e004");
    check("提案中の需要は提案のツールに渡らない", JSON.stringify(getCard({ card_id: "card-e023-01" })).indexOf("需要あり") < 0);
    resolveReaction("card-e023-01", dm!.id, true);
    const lines = reactionLines(loadCards().find((c) => c.card_id === "card-e023-01")!);
    check("採用すると提案のツールに渡る", JSON.stringify(getCard({ card_id: "card-e023-01" })).includes("需要あり"), lines[0]);
    const recLines = reactionLines(loadCards().find((c) => c.card_id === "card-e004-01")!);
    check("登壇者の記録は Agent にだけ渡す（判断の参考・文には書かない）", recLines.some((l) => l.startsWith("登壇の反応（内部の参考。理由・注意点・声かけ文には書かない）")));
    check("提案に渡す文に内部の言葉がない", [...lines, ...recLines].every((l) => internalTerms(l).length === 0));

    // ---- 確認済みのカードは上書きしない
    patchCard("card-e004-01", (c) => ({ ...c, reviewed: true, reviewed_at: "2026-11-20T00:00:00Z", pending_themes: [] }));
    const before = loadCards().find((c) => c.card_id === "card-e004-01")!;
    await analyzeEvent("ev020", () => undefined, { analyzer: fake([fakeInput("ev020")]) });
    const after = loadCards().find((c) => c.card_id === "card-e004-01")!;
    check(
      "確認済みカードの要約・テーマ案・おすすめの形は変えない",
      after.summary === before.summary && JSON.stringify(after.themes) === JSON.stringify(before.themes) && after.format === before.format && after.format_reason === before.format_reason,
    );
    const dm2 = loadCards().find((c) => c.card_id === "card-e023-01")!.reactions!.find((r) => r.id === dm!.id);
    check("採用済みの需要ありは再分析で戻さない", dm2?.status === "adopted");
  } finally {
    fs.writeFileSync(CARDS, original);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  check("data/cards.json を元に戻した", fs.readFileSync(CARDS).equals(original));
  console.log(failed === 0 ? "\nすべて合格" : `\n${failed}件 不合格`);
  process.exitCode = failed ? 1 : 0;
}

main();
