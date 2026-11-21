// アンケートを本番で分析して、保存済みの結果（docs/survey_latest.json）を作る。APIを使う（1イベント約$0.05〜0.1）。
//   npx tsx scripts/analyze_surveys.ts ev019          1件だけ（試すとき）
//   npx tsx scripts/analyze_surveys.ts all            アンケートのある全イベント
// 結合テストの --offline と、画面の ?mock（scripts/update_postevent_mock.ts）がこの結果を使う。
// 書き戻しで変わった data/cards.json は最後に元に戻す（ネタ帳はデモの前の状態のまま）。
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

try {
  process.loadEnvFile(".env");
} catch {
  console.error(".env がありません。APIを使うので .env の ANTHROPIC_API_KEY が必要です。");
  process.exit(1);
}
// アンケートは架空データのイベントだけ。.env に DATA_SOURCE があっても切り替えない（結合テストと同じ）
delete process.env.DATA_SOURCE;

import { events } from "../lib/data";
import { surveys } from "../lib/surveyCsv";
import { analyzeEvent, type EventAnalysis } from "../lib/surveys";
import { runUsd, totalUsd } from "../lib/usage";
import { loadSavedAnalyses, withCardsRestored } from "./eval_survey";

async function main() {
  const arg = process.argv[2] ?? "";
  const withSurveys = [...new Set(surveys().map((s) => s.event_id))];
  const ids = arg === "all" ? withSurveys : arg.split(",").filter(Boolean);
  if (!ids.length || ids.some((id) => !withSurveys.includes(id))) {
    console.error(`使い方: npx tsx scripts/analyze_surveys.ts <イベントid,...> | all（アンケートのあるイベント：${withSurveys.join(", ")}）`);
    process.exit(1);
  }
  const runId = randomUUID();
  const out: Record<string, EventAnalysis> = { ...(loadSavedAnalyses()?.analyses ?? {}) };
  await withCardsRestored(async () => {
    for (const id of ids) {
      const ev = events().find((e) => e.id === id)!;
      console.log(`\n=== ${id} ${ev.title}`);
      const a = await analyzeEvent(id, (e) => {
        if (e.type === "rejected") console.log(`  差し戻し：${e.errors.join(" / ")}`);
        if (e.type === "writeback") console.log(`  ${e.message}`);
        if (e.type === "error") console.log(`  エラー：${e.message}`);
      }, { runId });
      if (a) {
        out[id] = a;
        console.log(`  $${a.run_usd.toFixed(3)}（ここまで $${runUsd(runId).toFixed(3)}）`);
      }
    }
  });
  fs.writeFileSync(path.join(process.cwd(), "docs", "survey_latest.json"), JSON.stringify({ at: new Date().toISOString(), analyses: out }, null, 2) + "\n");
  console.log(`\n保存：docs/survey_latest.json（${Object.keys(out).join(", ")}）`);
  console.log(`今回 $${runUsd(runId).toFixed(3)}／累計 $${totalUsd().toFixed(3)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
