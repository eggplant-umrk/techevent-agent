// 画面のモック（?mock）で再生する、アンケート分析の保存済みの結果（app/_client/postevent.json）を作る。
//   npx tsx scripts/update_postevent_mock.ts
// 本番で分析した結果（data/survey_analysis.json）と、そのとき書き戻したカード（data/cards.json）から作る。APIは使わない。
import fs from "node:fs";
import path from "node:path";
import { loadCards } from "../lib/cards";
import { loadAnalyses } from "../lib/surveys";

const analyses = loadAnalyses();
const cards = loadCards();
const out: Record<string, unknown> = {};
for (const [eventId, analysis] of Object.entries(analyses)) {
  const cardsOut: Record<string, { reactions: unknown[]; pending_themes_added: string[] }> = {};
  const ownThemes = new Set(analysis.talks.flatMap((t) => t.next_themes.filter((n) => !n.overlaps_card_id).map((n) => n.text.trim())));
  for (const c of cards) {
    const reactions = (c.reactions ?? []).filter((r) => r.event_id === eventId).map((r) => ({ ...r, status: r.status === "dismissed" ? "pending" : r.status }));
    const speaker = analysis.talks.some((t) => t.speaker_id === c.employee_id);
    const pending = speaker ? c.pending_themes.filter((p) => ownThemes.has(p)) : [];
    if (reactions.length || pending.length) cardsOut[c.card_id] = { reactions, pending_themes_added: pending };
  }
  out[eventId] = { analysis, cards: cardsOut };
}
fs.writeFileSync(path.join(process.cwd(), "app", "_client", "postevent.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote app/_client/postevent.json (${Object.keys(out).join(", ") || "なし"})`);
