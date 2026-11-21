// 画面の操作・候補づくりの結果を保存するファイル（data/runtime/・data/inbox.json など）の書き込み。
// 書いている最中にサーバーが止まっても、0バイトや書きかけのファイルが残らないように、一時ファイルに書いてから置き換える。
import fs from "node:fs";
import path from "node:path";

let seq = 0;
const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** 一時ファイル（同じフォルダ）に書いてから置き換える。Windows で読み手と重なって置き換えに失敗したら、少し待って数回やり直す */
export function writeFileAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${++seq}.tmp`;
  try {
    fs.writeFileSync(/*turbopackIgnore: true*/ tmp, text, "utf-8");
  } catch (e) {
    fs.rmSync(/*turbopackIgnore: true*/ tmp, { force: true });
    throw e;
  }
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(/*turbopackIgnore: true*/ tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 5 || !(code === "EPERM" || code === "EBUSY" || code === "EACCES")) {
        fs.rmSync(/*turbopackIgnore: true*/ tmp, { force: true });
        throw e;
      }
      sleepSync(20 * (i + 1));
    }
  }
}

/** JSON を整形して書く（末尾に改行） */
export function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n");
}
