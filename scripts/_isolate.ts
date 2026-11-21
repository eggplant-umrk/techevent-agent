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
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
}
