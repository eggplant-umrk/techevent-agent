// 画面のモック（?mock）で再生する、アンケート分析の保存済みの結果（app/_client/postevent.json）を作る。APIは使わない。
//   npx tsx scripts/update_postevent_mock.ts
// 元は本番で分析した結果（docs/survey_latest.json。scripts/analyze_surveys.ts が作る）。
// カードへの書き戻し（コード）をいまのネタ帳に当てて、書き戻される反応とテーマ案を記録する。data/cards.json は元に戻す。
// 画面に出すのはイベント単位の集計だけなので、ここにも登壇者ごとの項目（だれの登壇か・登壇ごとのまとめ・点数・不満の登壇者）は入れない。
//   overview：イベント単位の集計（lib/surveyOverview.ts の analysisOverview と同じ形）
//   voices：アンケートの声（次に聞きたいテーマ・件数・話せそうな人のカード）。どの登壇への声かは入れない
import fs from "node:fs";
import path from "node:path";
import { loadCards } from "../lib/cards";
import { employeeById, events } from "../lib/data";
import { overviewProblems, PER_SPEAKER_KEYS, writeBack } from "../lib/surveys";
import { analysisOverview, surveyVoices } from "../lib/surveyOverview";
import { loadSavedAnalyses, withCardsRestored } from "./eval_survey";

async function main() {
  const saved = loadSavedAnalyses();
  const out: Record<string, unknown> = {};
  for (const [eventId, analysis] of Object.entries(saved?.analyses ?? {})) {
    const ev = events().find((e) => e.id === eventId)!;
    const cards: Record<string, { reactions: unknown[]; pending_themes_added: string[] }> = {};
    await withCardsRestored(() => {
      const before = new Map(loadCards().map((c) => [c.card_id, c]));
      const writebacks = writeBack(ev, analysis);
      const after = loadCards();
      for (const c of after) {
        const b = before.get(c.card_id)!;
        const reactions = (c.reactions ?? []).filter((r) => r.event_id === eventId);
        const added = c.pending_themes.filter((t) => !b.pending_themes.includes(t));
        if (reactions.length || added.length) cards[c.card_id] = { reactions, pending_themes_added: added };
      }
      const cardList = after
        .slice()
        .sort((a, b) => (a.latest_activity_date < b.latest_activity_date ? 1 : -1))
        .map((c) => ({ card_id: c.card_id, employee_id: c.employee_id, name: employeeById(c.employee_id)?.name ?? c.employee_id, themes: [...c.themes, ...c.pending_themes] }));
      const voices = surveyVoices([analysis], [ev], cardList).map((v) => ({ text: v.text, count: v.count, match_card_id: v.match?.card_id ?? null }));
      const overview = analysisOverview({ ...analysis, sample: true });
      const problems = overviewProblems({ stats: { answers: 0 } as never, analysis: overview });
      const leaked = PER_SPEAKER_KEYS.filter((k) => k !== "card_id" && JSON.stringify({ overview, voices }).includes(`"${k}"`));
      if (problems.length || leaked.length) throw new Error(`${eventId}：登壇者ごとの項目が入っています（${[...problems, ...leaked].join(" / ")}）`);
      out[eventId] = {
        overview,
        voices,
        model: analysis.model,
        run_usd: analysis.run_usd,
        sentences: analysis.labels.length,
        writebacks,
        cards,
      };
    });
  }
  fs.writeFileSync(path.join(process.cwd(), "app", "_client", "postevent.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote app/_client/postevent.json (${Object.keys(out).join(", ") || "なし"})`);
}

main();
