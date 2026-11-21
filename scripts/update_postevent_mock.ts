// 画面のモック（?mock）で再生する、アンケート分析の保存済みの結果（app/_client/postevent.json）を作る。APIは使わない。
//   npx tsx scripts/update_postevent_mock.ts
// 元は本番で分析した結果（docs/survey_latest.json。scripts/analyze_surveys.ts が作る）。
// カードへの書き戻し（コード）をいまのネタ帳に当てて、書き戻される反応とテーマ案を記録する。data/cards.json は元に戻す。
import fs from "node:fs";
import path from "node:path";
import { loadCards } from "../lib/cards";
import { events } from "../lib/data";
import { writeBack } from "../lib/surveys";
import { loadSavedAnalyses, withCardsRestored } from "./eval_survey";

async function main() {
  const saved = loadSavedAnalyses();
  const out: Record<string, unknown> = {};
  for (const [eventId, analysis] of Object.entries(saved?.analyses ?? {})) {
    const cards: Record<string, { reactions: unknown[]; pending_themes_added: string[] }> = {};
    await withCardsRestored(() => {
      const before = new Map(loadCards().map((c) => [c.card_id, c]));
      const writebacks = writeBack(events().find((e) => e.id === eventId)!, analysis.talks);
      for (const c of loadCards()) {
        const b = before.get(c.card_id)!;
        const reactions = (c.reactions ?? []).filter((r) => r.event_id === eventId);
        const added = c.pending_themes.filter((t) => !b.pending_themes.includes(t));
        if (reactions.length || added.length) cards[c.card_id] = { reactions, pending_themes_added: added };
      }
      out[eventId] = { analysis: { ...analysis, writebacks }, cards };
    });
  }
  fs.writeFileSync(path.join(process.cwd(), "app", "_client", "postevent.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote app/_client/postevent.json (${Object.keys(out).join(", ") || "なし"})`);
}

main();
