// 評価・テスト用：実行時のデータ（data/runtime/、画面での操作の結果）を読まず、元のデータだけで動かす。
// 一時フォルダを実行時のデータの置き場所にして、終わったら消す。各スクリプトの最初に import する。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 評価・テストは「今日」を固定して動かす（ふだんは日本時間の実際の日付。lib/clock.ts）
if (!process.env.FIXED_TODAY) process.env.FIXED_TODAY = "2026-11-21";

if (!process.env.DATA_RUNTIME_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "techevent-runtime-"));
  process.env.DATA_RUNTIME_DIR = dir;
  // 金額の記録も一時ファイルに（テストで本物の data/usage.json を汚さない）。
  // ただし API を使う評価（scripts/eval.ts を --offline なしで流すとき）は本物の記録に残す（累計と上限の判定に使うため）
  const realApiEval = /eval\.ts$/.test(process.argv[1] ?? "") && !process.argv.includes("--offline");
  if (!process.env.USAGE_FILE && !realApiEval) process.env.USAGE_FILE = path.join(dir, "usage.json");
  // 画面の操作の記録（受信箱・サンプルの依頼の結果・下書き・登壇の記録・人の情報・取り込んだアンケート）も一時フォルダに。
  // テストが本物の data/inbox.json などに書かないように（発表用の作業場所で npm test を流しても、受信箱が増えない）
  if (!realApiEval) {
    const files: Record<string, string> = {
      INBOX_FILE: "inbox.json",
      SAMPLE_PROPOSALS_FILE: "sample_proposals.json",
      DRAFTS_FILE: "drafts.json",
      TALK_RECORD_FILE: "talk_records.json",
      PEOPLE_FILE: "people.json",
      SURVEY_IMPORT_DIR: "survey_imports",
    };
    for (const [k, name] of Object.entries(files)) if (!process.env[k]) process.env[k] = path.join(dir, name);
  }
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
}
