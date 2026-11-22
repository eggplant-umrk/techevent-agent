// 画面の操作・候補づくりの結果を保存するファイル（data/runtime/・data/inbox.json など）の読み書き。
// - 書き込み：書いている最中にサーバーが止まっても、0バイトや書きかけのファイルが残らないように、一時ファイルに書いてから置き換える
// - 読み込み：0バイト・壊れた JSON・形が違うときは、落とさずに「空」として続ける。壊れたファイルは消さずに
//   「<名前>.broken-<日時>」に退けて、サーバーの記録に残す（あとで人が中身を確かめられるように）
import fs from "node:fs";
import path from "node:path";

/** 形の確かめ：配列か、オブジェクト（配列でない）か、自分で確かめる関数 */
export type JsonShape = "array" | "object" | ((v: unknown) => boolean);

const shapeOk = (v: unknown, shape: JsonShape) =>
  shape === "array" ? Array.isArray(v) : shape === "object" ? !!v && typeof v === "object" && !Array.isArray(v) : shape(v);

/** 日本時間の日時（ファイル名に使う）：20261122-091530-123 */
function stamp(): string {
  const j = new Date(Date.now() + 9 * 3600_000).toISOString(); // 2026-11-22T00:15:30.123Z を日本時間にずらしたもの
  return `${j.slice(0, 10).replace(/-/g, "")}-${j.slice(11, 19).replace(/:/g, "")}-${j.slice(20, 23)}`;
}

/** 壊れたファイルを「<名前>.broken-<日時>」に退ける（消さない）。退けた先を返す。退けられなければ null */
export function quarantineFile(file: string, reason: string): string | null {
  const to = `${file}.broken-${stamp()}`;
  try {
    fs.renameSync(/*turbopackIgnore: true*/ file, to);
    console.error(`[壊れたファイル] ${file} を読めませんでした（${reason}）。消さずに ${path.basename(to)} に退けて、空として続けます`);
    return to;
  } catch (e) {
    console.error(`[壊れたファイル] ${file} を読めませんでした（${reason}）。退けることもできませんでした（${e instanceof Error ? e.message : "不明なエラー"}）。空として続けます`);
    return null;
  }
}

/** 退けた壊れたファイルの一覧（同じフォルダの「<名前>.broken-…」） */
export function brokenCopies(file: string): string[] {
  const dir = path.dirname(file);
  const base = `${path.basename(file)}.broken-`;
  try {
    return fs.readdirSync(/*turbopackIgnore: true*/ dir).filter((f) => f.startsWith(base)).sort().map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * 保存したファイルを読む。ない → fallback。0バイト・壊れた JSON・形が違う → 退けてから fallback（落とさない）。
 * 元のデータ（git に入っているファイル）には使わない（退けると元のデータがなくなるため）
 */
export function readJsonSafe<T>(file: string, fallback: T, shape: JsonShape): T {
  let text: string;
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return fallback;
    text = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8");
  } catch (e) {
    console.error(`[読み込み] ${file} を開けませんでした（${e instanceof Error ? e.message : "不明なエラー"}）。空として続けます`);
    return fallback;
  }
  let reason: string;
  if (!text.trim()) reason = "中身が空";
  else {
    try {
      const v = JSON.parse(text) as unknown;
      if (shapeOk(v, shape)) return v as T;
      reason = "形が違う";
    } catch {
      reason = "JSON として読めない";
    }
  }
  quarantineFile(file, reason);
  return fallback;
}

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
