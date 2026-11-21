// Refresh the screen's mock fixtures from docs/eval_latest.json（最新の評価結果）.
//   npx tsx scripts/update_mock.ts
// - app/_client/proposals.json：依頼 → 候補（依頼5件）
// - app/_client/venues.json：カード → 出し先（venue_cases があれば）
// No API calls.
import fs from "node:fs";
import path from "node:path";
import { busynessFor, busyText } from "../lib/busyness";

const root = process.cwd();
const latest = JSON.parse(fs.readFileSync(path.join(root, "docs", "eval_latest.json"), "utf-8")) as {
  rows: Array<{ request_id: string; result: unknown; steps: number; run_usd: number }>;
  venue_cases?: Array<{ card_id: string; result: unknown; events: unknown[]; run_usd: number }>;
};
/**
 * 忙しさ（予定から計算）：候補の busy_text を予定から計算して入れ、決め打ちの workload は消す。
 * コードが足した注意点「忙しい（忙しさN）」も、今の計算（詰まっているときだけ busyText）に置き換える。
 * Agent が書いた文（理由・引っかかる点）は保存結果のまま（変えるには評価を流し直す）。
 */
function withBusy(result: unknown): unknown {
  const r = result as { candidates?: Array<Record<string, unknown>> };
  if (!r?.candidates) return result;
  return {
    ...r,
    candidates: r.candidates.map(({ workload: _fixed, ...c }) => {
      const b = busynessFor(String(c.employee_id));
      const cautions = ((c.cautions as string[]) ?? []).filter((x) => !/^忙しい（忙しさ\d）$/.test(x));
      if (b.known && b.level === "詰まっている" && !cautions.some((x) => x.startsWith("今後2週"))) cautions.push(busyText(b));
      return { ...c, busy_text: busyText(b), cautions };
    }),
  };
}

const out: Record<string, { result: unknown; steps: number; run_usd: number }> = {};
for (const r of latest.rows) if (r.result) out[r.request_id] = { result: withBusy(r.result), steps: r.steps, run_usd: r.run_usd };
fs.writeFileSync(path.join(root, "app", "_client", "proposals.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote app/_client/proposals.json (${Object.keys(out).join(", ")})`);

if (latest.venue_cases) {
  const venues: Record<string, { result: unknown; events: unknown[]; run_usd: number }> = {};
  for (const v of latest.venue_cases) if (v.result) venues[v.card_id] = { result: v.result, events: v.events, run_usd: v.run_usd };
  fs.writeFileSync(path.join(root, "app", "_client", "venues.json"), JSON.stringify(venues, null, 2) + "\n");
  console.log(`wrote app/_client/venues.json (${Object.keys(venues).join(", ")})`);
}
