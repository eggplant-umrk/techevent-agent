// 元のデータと、画面で触った結果（実行時のデータ）を分ける。
//   - 元のデータ（data/*.json、data/sources/…）は読むだけ。git に入っているのはこちら
//   - 画面での操作・ネタ帳の更新の結果などは data/runtime/（git の対象外）に保存し、読むときは元のデータに重ねる
//     DATA_SOURCE=github などのときは data/runtime/<source>/ に分ける
//   - npm run reset:demo で data/runtime/ を片付けると、元のデータだけの初期状態に戻る
//   - 評価・テストは DATA_RUNTIME_DIR を一時フォルダにして、元のデータだけで動く
import fs from "node:fs";
import { readJsonSafe, writeFileAtomic } from "./fileStore";
import path from "node:path";
import { dataSource } from "./dataSource";
import { scopedFile } from "./visitorScope";

/** 実行時のデータの置き場（人ごとに分ける前）。見せる用で全員分を1つで持つもの（金額の記録など）はここに置く */
export function runtimeRoot(): string {
  return process.env.DATA_RUNTIME_DIR || path.join(process.cwd(), "data", "runtime");
}

/** 実行時のデータの置き場所（データの切り替えごとに分ける） */
export function runtimeFile(name: string): string {
  const s = dataSource();
  // 見せる用（SHARE_MODE=lan）では、今の人の場所（<置き場>/visitors/{人}/。lib/visitorScope.ts）
  return scopedFile(s ? path.join(runtimeRoot(), s, name) : path.join(runtimeRoot(), name));
}

export function readJsonFile<T>(file: string, fallback: T): T {
  return fs.existsSync(/*turbopackIgnore: true*/ file) ? (JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8")) as T) : fallback;
}

function writeJsonFile(file: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (fs.existsSync(/*turbopackIgnore: true*/ file) && fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8") === text) return;
  writeFileAtomic(file, text); // 一時ファイルに書いてから置き換える（書きかけを残さない）
}

// ---------------------------------------------------------------------------
// キーごとの記録（社員 id → 値 など）：元のデータに実行時のデータを重ねる。書くのは、元と違うキーだけ
// ---------------------------------------------------------------------------
export function readOverlay<T>(baseFiles: string[], name: string): Record<string, T> {
  const merged: Record<string, T> = {};
  for (const f of baseFiles) Object.assign(merged, readJsonFile<Record<string, T>>(f, {}));
  // 実行時のデータは、壊れていたら退けて空として重ねる（元のデータは退けない）
  return Object.assign(merged, readJsonSafe<Record<string, T>>(runtimeFile(name), {}, "object"));
}

export function writeOverlay<T>(baseFiles: string[], name: string, all: Record<string, T>) {
  const base: Record<string, T> = {};
  for (const f of baseFiles) Object.assign(base, readJsonFile<Record<string, T>>(f, {}));
  const diff: Record<string, T> = {};
  for (const [k, v] of Object.entries(all)) if (JSON.stringify(v) !== JSON.stringify(base[k])) diff[k] = v;
  const file = runtimeFile(name);
  if (!Object.keys(diff).length && !fs.existsSync(/*turbopackIgnore: true*/ file)) return;
  writeJsonFile(file, diff);
}

// ---------------------------------------------------------------------------
// 一覧（丸ごと置き換え）：実行時のデータがあればそれを使い、なければ元のデータ
// ---------------------------------------------------------------------------
export function readReplaced<T>(baseFile: string, name: string, fallback: T): T {
  const rt = runtimeFile(name);
  // 実行時のデータが壊れていたら退けて、元のデータを使う（元のデータは退けない）
  const MISSING = Symbol("missing");
  const v = readJsonSafe<T | typeof MISSING>(rt, MISSING, Array.isArray(fallback) ? "array" : "object");
  return v !== MISSING ? v : readJsonFile<T>(baseFile, fallback);
}
export function writeReplaced(name: string, value: unknown) {
  writeJsonFile(runtimeFile(name), value);
}

// ---------------------------------------------------------------------------
// カード：id ごとに重ねる。書くのは、元のデータと中身が違うカードだけ（空の項目は書かない）
// ---------------------------------------------------------------------------
export interface CardOverlay<C> {
  /** 元のデータから変わったカード・新しいカード（空の項目は省く） */
  cards: C[];
  /** 元のデータから消したカードの id */
  deleted: string[];
}

export function readCardOverlay<C>(): CardOverlay<C> {
  // 壊れていたら退けて、元のデータのカードだけにする（落とさない）
  const ok = (v: unknown) => !!v && typeof v === "object" && Array.isArray((v as CardOverlay<C>).cards) && Array.isArray((v as CardOverlay<C>).deleted);
  return readJsonSafe<CardOverlay<C>>(runtimeFile("cards.json"), { cards: [], deleted: [] }, ok);
}

export function writeCardOverlay<C>(o: CardOverlay<C>) {
  const file = runtimeFile("cards.json");
  if (!o.cards.length && !o.deleted.length && !fs.existsSync(/*turbopackIgnore: true*/ file)) return;
  writeJsonFile(file, o);
}

/** 片付ける対象（npm run reset:demo）：実行時のデータの置き場所と、もともと git の対象外だった画面の操作の記録 */
export function resetTargets(): string[] {
  // 置き場所を DATA_RUNTIME_DIR で分けたサーバー（見せる用など）は、画面の操作の記録もすべてその中にあるので、そこだけを片付ける
  // （発表用の data/inbox.json などには触らない）
  if (process.env.DATA_RUNTIME_DIR) return [runtimeRoot()];
  const d = path.join(process.cwd(), "data");
  return [runtimeRoot(), path.join(d, "inbox.json"), path.join(d, "sample_proposals.json"), path.join(d, "drafts.json"), path.join(d, "talk_records.json"), path.join(d, "people.json")];
}
