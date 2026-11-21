// アンケート分析と書き戻しのテスト（APIを使わない）：npm run test:surveys
// 本物の Agent の代わりに、決まった答えを返す偽の analyzer を使う。
// data/cards.json は書き戻しで変わるので、終わったらバイトごと元に戻す。分析結果は一時ファイルに書く。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.SURVEY_ANALYSIS_FILE = path.join(os.tmpdir(), `survey-test-${Date.now()}.json`);

import { loadCards, patchCard } from "../lib/cards";
import { surveys } from "../lib/data";
import { internalTerms } from "../lib/plainText";
import { analyzeEvent, reactionLines, resolveReaction, talkStats, validateAnalysis, type AnalysisInput, type Analyzer, type SurveyEvent } from "../lib/surveys";
import { getCard } from "../lib/tools";

const CARDS = path.join(process.cwd(), "data", "cards.json");
const original = fs.readFileSync(CARDS);

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

const all = surveys();
const pick = (ev: string, sp: string, need: "comment" | "want_next", match?: string) =>
  all
    .filter((s) => s.event_id === ev && s.talk_speaker_id === sp && (need === "comment" ? s.comment.trim() : s.want_next))
    .filter((s) => !match || (need === "comment" ? s.comment : s.want_next ?? "").includes(match))
    .map((s) => s.id);

/** ev019 の正しいまとめ（久住さん・青柳さん） */
function goodInput(): AnalysisInput {
  return {
    talks: [
      {
        speaker_id: "e003",
        summary: "ガードレールの具体例と本番の失敗談が刺さり、続編を望む声が多かった",
        hits: [{ text: "ガードレールの具体例がすぐ試せる", response_ids: pick("ev019", "e003", "comment", "ガードレール").slice(0, 3) }],
        stumbles: [{ text: "ツール呼び出しの制限のかけ方をもっと知りたい", response_ids: pick("ev019", "e003", "comment", "ツール呼び出し").slice(0, 2) }],
        next_themes: [
          { text: "ガードレールの続編：本番で起きた失敗と直し方", response_ids: pick("ev019", "e003", "want_next", "続編").slice(0, 3), overlaps_card_id: null },
          { text: "エージェントの回帰テストをCIで回す方法", response_ids: pick("ev019", "e003", "want_next", "CI").slice(0, 3), overlaps_card_id: "card-e013-01" },
        ],
      },
      {
        speaker_id: "e001",
        summary: "判断軸の整理は好評だったが、具体的な構成図を求める声もあった",
        hits: [{ text: "選定の判断軸が整理されていた", response_ids: pick("ev019", "e001", "comment", "判断軸").slice(0, 2) }],
        stumbles: [{ text: "抽象的で具体例がほしい", response_ids: pick("ev019", "e001", "comment", "抽象的").slice(0, 2) }],
        next_themes: [],
      },
    ],
  };
}

function fake(answers: AnalysisInput[]): Analyzer {
  let i = 0;
  return async () => ({ input: answers[Math.min(i++, answers.length - 1)], content: [], tool_use_id: `t${i}`, model: "test" });
}

async function main() {
  try {
    // ---- 数字はコードで計算
    const st = talkStats("ev019");
    const e003 = st.find((s) => s.speaker_id === "e003")!;
    const rows = all.filter((s) => s.event_id === "ev019" && s.talk_speaker_id === "e003");
    check("件数がデータと一致", e003.count === rows.length, `${e003.count}件`);
    check("平均が小数1桁でデータと一致", e003.average === Math.round((rows.reduce((a, r) => a + r.rating, 0) / rows.length) * 10) / 10, `${e003.average}`);
    check("分布の合計が件数と一致", e003.distribution.reduce((a, b) => a + b, 0) === e003.count);
    check("アンケートのないイベントは空", talkStats("ev001").length === 0);

    // ---- 検証
    check("正しいまとめは通る", validateAnalysis("ev019", goodInput()).length === 0, validateAnalysis("ev019", goodInput()).join(" / "));
    const bad = (mut: (x: AnalysisInput) => void) => {
      const x = goodInput();
      mut(x);
      return validateAnalysis("ev019", x);
    };
    check("存在しない回答idは弾く", bad((x) => x.talks[0].hits[0].response_ids.push("s9999")).some((e) => e.includes("存在しません")));
    check("別の登壇への回答は弾く", bad((x) => x.talks[0].hits[0].response_ids.push(pick("ev019", "e001", "comment")[0])).some((e) => e.includes("この登壇への回答ではありません")));
    const blank = all.find((s) => s.event_id === "ev019" && s.talk_speaker_id === "e003" && !s.comment.trim())!.id;
    check("感想が空欄の回答を根拠にすると弾く", bad((x) => x.talks[0].hits[0].response_ids.push(blank)).some((e) => e.includes("空欄")));
    check("本人のカードとの重なりは弾く", bad((x) => (x.talks[0].next_themes[1].overlaps_card_id = "card-e003-01")).some((e) => e.includes("本人のカード")));
    check("発信済みのカードとの重なりは弾く", bad((x) => (x.talks[0].next_themes[1].overlaps_card_id = "card-e001-01")).some((e) => e.includes("未発信")));
    check("内部の言葉は弾く", bad((x) => (x.talks[0].summary = "reviewed=false のカード")).some((e) => e.includes("内部")));
    check("数字（件数・平均）は弾く", bad((x) => (x.talks[0].summary = "平均4.9で続編希望が5件")).some((e) => e.includes("数字")));
    check("登壇の抜けは弾く", bad((x) => x.talks.pop()).some((e) => e.includes("分析がありません")));

    // ---- 分析 → 差し戻し → 書き戻し（未確認のカード）
    const log: SurveyEvent[] = [];
    const wrong = goodInput();
    wrong.talks[0].summary = "満足度の平均は4.9でした";
    const a = await analyzeEvent("ev019", (e) => log.push(e), { analyzer: fake([wrong, goodInput()]) });
    check("1回目は差し戻し、2回目で通る", !!a && log.filter((e) => e.type === "rejected").length === 1 && log.filter((e) => e.type === "step").length === 2);
    check("保存した数字はコードの計算と一致", JSON.stringify(a?.talks.find((t) => t.speaker_id === "e003")?.stats) === JSON.stringify(e003));
    const c3 = loadCards().find((c) => c.card_id === "card-e003-01")!;
    const rx = c3.reactions?.find((r) => r.kind === "reception");
    check("登壇者のカードに反応のまとめ（未確認カードなので採用済み）", rx?.status === "adopted" && rx.count === e003.count && rx.average === e003.average);
    check("次に聞きたいテーマはテーマ案（未確認）に", c3.pending_themes.includes("ガードレールの続編：本番で起きた失敗と直し方") && !c3.themes.includes("ガードレールの続編：本番で起きた失敗と直し方"));
    const c13 = loadCards().find((c) => c.card_id === "card-e013-01")!;
    const dm = c13.reactions?.find((r) => r.kind === "demand");
    check("重なるテーマは別の社員のカードに「需要あり」の提案", dm?.status === "pending" && dm.from_speaker_id === "e003");
    check("提案中の需要は提案のツールに渡らない", reactionLines(c13).length === 0 && JSON.stringify(getCard({ card_id: "card-e013-01" })).indexOf("需要あり") < 0);
    resolveReaction("card-e013-01", dm!.id, true);
    const lines = reactionLines(loadCards().find((c) => c.card_id === "card-e013-01")!);
    check("採用すると提案のツールに渡る", lines.some((l) => l.includes("需要あり")) && JSON.stringify(getCard({ card_id: "card-e013-01" })).includes("需要あり"), lines[0]);
    check("提案に渡す文に内部の言葉がない", [...lines, ...reactionLines(loadCards().find((c) => c.card_id === "card-e003-01")!)].every((l) => internalTerms(l).length === 0));

    // ---- 確認済みのカードは上書きしない
    patchCard("card-e003-01", (c) => ({ ...c, reviewed: true, reviewed_at: "2026-11-20T00:00:00Z", reactions: [], pending_themes: [] }));
    const before = loadCards().find((c) => c.card_id === "card-e003-01")!;
    await analyzeEvent("ev019", () => undefined, { analyzer: fake([goodInput()]) });
    const after = loadCards().find((c) => c.card_id === "card-e003-01")!;
    check(
      "確認済みカードの要約・テーマ案・おすすめの形は変えない",
      after.summary === before.summary && JSON.stringify(after.themes) === JSON.stringify(before.themes) && after.format === before.format && after.format_reason === before.format_reason,
    );
    check("確認済みカードへの反応のまとめは提案（未採用）", after.reactions?.find((r) => r.kind === "reception")?.status === "pending");
    check("提案中の反応は提案のツールに渡らない", reactionLines(after).length === 0);

    // ---- 見送った提案は、もう一度分析しても戻らない
    const pend = after.reactions!.find((r) => r.kind === "reception")!;
    resolveReaction("card-e003-01", pend.id, false);
    await analyzeEvent("ev019", () => undefined, { analyzer: fake([goodInput()]) });
    check("見送った提案は再分析で復活しない", loadCards().find((c) => c.card_id === "card-e003-01")!.reactions!.find((r) => r.id === pend.id)?.status === "dismissed");
  } finally {
    fs.writeFileSync(CARDS, original);
    fs.rmSync(process.env.SURVEY_ANALYSIS_FILE!, { force: true });
  }
  check("data/cards.json を元に戻した", fs.readFileSync(CARDS).equals(original));
  console.log(failed === 0 ? "\nすべて合格" : `\n${failed}件 不合格`);
  process.exitCode = failed ? 1 : 0;
}

main();
