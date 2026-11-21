// アンケートの取り込み・分析・書き戻しのテスト（APIを使わない）：npm run test:surveys
// 本物の Agent の代わりに、キーワードで文を分ける偽の analyzer を使う。
// data/cards.json は書き戻しで変わるので、終わったらバイトごと元に戻す。分析結果と取り込みは一時ファイルに書く。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "survey-test-"));
process.env.SURVEY_ANALYSIS_FILE = path.join(TMP, "analysis.json");
process.env.SURVEY_IMPORT_DIR = path.join(TMP, "imports");

import { loadCards, patchCard } from "../lib/cards";
import { events } from "../lib/data";
import { internalTerms } from "../lib/plainText";
import { detectColumns, importSurveyCsv, loadImport, parseCsv, saveImport, surveys, type ColumnAsker } from "../lib/surveyCsv";
import {
  analyzeEvent,
  cardLeakProblems,
  contentFact,
  eventMessage,
  reactionLines,
  resolveReaction,
  sentencesOf,
  talkStats,
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
    if (OTHER.test(s.text)) return { id: s.id, polarity: "other" as const, topic: null, attack: false };
    if (BAD.test(s.text)) return { id: s.id, polarity: "bad" as const, topic: OPS.test(s.text) ? ("operation" as const) : ("content" as const), attack: ATTACK.test(s.text) };
    return { id: s.id, polarity: "good" as const, topic: null, attack: false };
  });
  const speakers = talkStats(eventId, all).map((t) => t.speaker_id);
  const positive_themes = speakers
    .map((sp) => {
      const ids = sentences.filter((l) => l.polarity === "good" && sents.find((s) => s.id === l.id)!.speaker_id === sp).map((l) => l.id);
      return { speaker_id: sp, theme: "話の中身が参考になった", sentence_ids: ids, representative_ids: ids.slice(0, 1) };
    })
    .filter((t) => t.sentence_ids.length);
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
    const rows19 = parseCsv(csvOf("ev019")).slice(1).filter((r) => r[2].startsWith("久住"));
    const st = talkStats("ev019").find((s) => s.speaker_id === "e003")!;
    const avg = Math.round((rows19.reduce((a, r) => a + Number(r[3]), 0) / rows19.length) * 10) / 10;
    check("件数・平均が CSV と一致", st.count === rows19.length && st.average === avg, `${st.count}件・平均${st.average}`);
    check("分布の合計が件数と一致", st.distribution.reduce((a, b) => a + b, 0) === st.count);
    check("点数の高い登壇・低い登壇を洗い出す", st.highlight === "high" && talkStats("ev020").find((s) => s.speaker_id === "e004")?.highlight === "low");
    check("空欄・「特になし」の回答は除外して数える", st.excluded === rows19.filter((r) => ["", "なし", "特になし"].includes(r[4].trim()) && !r[5].trim()).length);
    const mixed = sentencesOf("ev019").filter((s) => s.answer_id === all.find((a) => a.comment.startsWith("内容はとても良かったです。ただ"))?.id);
    check("1つの回答を文に分ける（良い点と不満が混ざる回答）", mixed.length === 2, mixed.map((m) => m.text).join(" / "));

    // ---------------------------------------------------------------- AI に渡すもの
    const msg = eventMessage(events().find((e) => e.id === "ev019")!);
    check("AI に CSV 全体・個人情報を渡さない", !msg.includes("@") && !/2026\/09\/11 \d/.test(msg) && !/山田 花子|佐藤 健/.test(msg) && !msg.includes("どの登壇についての回答ですか"));
    check("AI に集計結果と自由記述を渡す", msg.includes(`回答${st.count}件・満足度の平均${st.average}`) && mixed.every((m) => msg.includes(`${m.id}｜${m.text}`)));

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

    const c4 = loadCards().find((c) => c.card_id === "card-e004-01")!;
    const rx = c4.reactions?.find((r) => r.kind === "reception");
    const t4 = a.talks.find((x) => x.speaker_id === "e004")!;
    check("カードには内容への不満の事実だけ", rx?.stumbles.length === 1 && rx.stumbles[0] === contentFact(t4) && /^前回は.+を指摘する声が\d+件$/.test(rx.stumbles[0]), rx?.stumbles[0]);
    check("カードに不満の原文・運営への不満・攻撃の言葉が入らない", cardLeakProblems(a).length === 0 && !JSON.stringify(loadCards().flatMap((c) => c.reactions ?? [])).includes(attackText));
    check("良かった点はテーマと件数だけ", (rx?.hits ?? []).every((h) => /（\d+件）$/.test(h)));
    const dm = loadCards().find((c) => c.card_id === "card-e023-01")!.reactions?.find((r) => r.kind === "demand");
    check("重なるテーマは別の社員のカードに「需要あり」の提案", dm?.status === "pending" && dm.from_speaker_id === "e004");
    check("提案中の需要は提案のツールに渡らない", JSON.stringify(getCard({ card_id: "card-e023-01" })).indexOf("需要あり") < 0);
    resolveReaction("card-e023-01", dm!.id, true);
    const lines = reactionLines(loadCards().find((c) => c.card_id === "card-e023-01")!);
    check("採用すると提案のツールに渡る", JSON.stringify(getCard({ card_id: "card-e023-01" })).includes("需要あり"), lines[0]);
    check("提案に渡す文に内部の言葉がない", [...lines, ...reactionLines(loadCards().find((c) => c.card_id === "card-e004-01")!)].every((l) => internalTerms(l).length === 0));

    // ---- 確認済みのカードは上書きしない・見送りは戻らない
    patchCard("card-e004-01", (c) => ({ ...c, reviewed: true, reviewed_at: "2026-11-20T00:00:00Z", reactions: [], pending_themes: [] }));
    const before = loadCards().find((c) => c.card_id === "card-e004-01")!;
    await analyzeEvent("ev020", () => undefined, { analyzer: fake([fakeInput("ev020")]) });
    const after = loadCards().find((c) => c.card_id === "card-e004-01")!;
    check(
      "確認済みカードの要約・テーマ案・おすすめの形は変えない",
      after.summary === before.summary && JSON.stringify(after.themes) === JSON.stringify(before.themes) && after.format === before.format && after.format_reason === before.format_reason,
    );
    const pend = after.reactions!.find((r) => r.kind === "reception")!;
    check("確認済みカードへの反応のまとめは提案（未採用）", pend.status === "pending" && reactionLines(after).length === 0);
    resolveReaction("card-e004-01", pend.id, false);
    await analyzeEvent("ev020", () => undefined, { analyzer: fake([fakeInput("ev020")]) });
    check("見送った提案は再分析で復活しない", loadCards().find((c) => c.card_id === "card-e004-01")!.reactions!.find((r) => r.id === pend.id)?.status === "dismissed");
  } finally {
    fs.writeFileSync(CARDS, original);
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  check("data/cards.json を元に戻した", fs.readFileSync(CARDS).equals(original));
  console.log(failed === 0 ? "\nすべて合格" : `\n${failed}件 不合格`);
  process.exitCode = failed ? 1 : 0;
}

main();
