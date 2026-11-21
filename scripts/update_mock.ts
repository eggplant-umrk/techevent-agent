// Refresh the screen's mock fixtures (app/_client/proposals.json) from docs/eval_after.json.
//   npx tsx scripts/update_mock.ts
// No API calls.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const after = JSON.parse(fs.readFileSync(path.join(root, "docs", "eval_after.json"), "utf-8")) as {
  rows: Array<{ request_id: string; result: unknown; steps: number; run_usd: number }>;
};
const out: Record<string, { result: unknown; steps: number; run_usd: number }> = {};
for (const r of after.rows) if (r.result) out[r.request_id] = { result: r.result, steps: r.steps, run_usd: r.run_usd };
fs.writeFileSync(path.join(root, "app", "_client", "proposals.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote app/_client/proposals.json (${Object.keys(out).join(", ")})`);
