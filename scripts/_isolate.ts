// 評価・テスト用：実行時のデータ（data/runtime/、画面での操作の結果）を読まず、元のデータだけで動かす。
// 一時フォルダを実行時のデータの置き場所にして、終わったら消す。各スクリプトの最初に import する。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.DATA_RUNTIME_DIR) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "techevent-runtime-"));
  process.env.DATA_RUNTIME_DIR = dir;
  process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
}
