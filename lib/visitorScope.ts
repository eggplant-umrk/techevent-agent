// 見せる用（SHARE_MODE=lan）で、実行時のデータの置き場所を人ごとに分ける：<見せる用の置き場>/visitors/{人の名前}/
//   - 人の名前は lib/visitor.ts の visitorKey（cookie nb_person のハッシュ）。決め方はそこに1つだけ
//   - 「今の人」：withVisitor で決めた人（裏の処理は始めたときの人で固定する）。なければ、Next.js が要求ごとに持つ
//     AsyncLocalStorage（要求の入口で作られ、裏の処理にも引き継がれる）の cookie から決める。どちらもなければ no-person
//   - 見せる用で実行時に書くファイルは、すべて今の人の場所に書く（scopedFile。lib/runtime.ts の runtimeFile・各ファイルの置き場所の関数が通す）。
//     例外は金額の記録（usage.json の全員の合計。SHARE_BUDGET_USD は全員の合計のまま）と、①の1人あたりの金額の台帳（person_usage.json）。
//     この2つは人ごとに分ける前の置き場（runtimeRoot()）に置く
//   - 元のデータ（data/*.json、data/sources/…）は読むだけのまま
//   - 発表用（SHARE_MODE なし）は何もしない（今までどおり data/runtime/ だけ）
//   - 人の場所の上限（VISITOR_MAX、既定200人）と、使われていない場所の片付け（VISITOR_IDLE_HOURS、既定12時間＝印の有効期限）
//   - 人の場所を初めて作るとき、サンプルの依頼に保存済みの結果（docs/eval_latest.json）を「準備済み」として入れる
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { shareMode } from "./share";
import { NO_VISITOR, VISITOR_COOKIE, isVisitorKey, visitorKey } from "./visitor";

const als = new AsyncLocalStorage<{ key: string }>();

/** 見せる用で、人ごとに分けるか */
export const visitorsOn = (): boolean => shareMode() === "lan";

/** 見せる用の置き場（人ごとに分ける前）。serve.mjs の SHARE_DATA_DIR（DATA_RUNTIME_DIR に入る）、なければ data/runtime-share */
export function shareBaseDir(): string {
  return path.resolve(process.env.DATA_RUNTIME_DIR || path.join(process.cwd(), "data", "runtime-share"));
}
export const visitorsDir = (): string => path.join(shareBaseDir(), "visitors");
export const visitorDir = (key: string): string => path.join(visitorsDir(), isVisitorKey(key) ? key : NO_VISITOR);

/** Next.js の要求の中なら、その要求の cookie から人の名前（要求の入口で Next.js が作る AsyncLocalStorage を読む） */
type NextStorage = { getStore(): { type?: string; cookies?: { get(name: string): { value?: string } | undefined } } | undefined };
let nextStorage: NextStorage | null | undefined; // 読めなかったら null（毎回読み直さない）
function keyFromNextRequest(): string | null {
  try {
    if (nextStorage === undefined) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        nextStorage = (require("next/dist/server/app-render/work-unit-async-storage.external") as { workUnitAsyncStorage?: NextStorage }).workUnitAsyncStorage ?? null;
      } catch {
        nextStorage = null; // Next.js の外（スクリプト・テスト）
      }
    }
    const store = nextStorage?.getStore();
    if (!store || store.type !== "request" || !store.cookies?.get) return null;
    return visitorKey(store.cookies.get(VISITOR_COOKIE)?.value ?? null);
  } catch {
    return null;
  }
}

/** 今の人の名前（見せる用でなければ null） */
export function currentVisitorKey(): string | null {
  if (!visitorsOn()) return null;
  return als.getStore()?.key ?? keyFromNextRequest() ?? NO_VISITOR;
}

/** fn の中（裏で続く処理も含む）を、人 key の場所で動かす。見せる用でなければ、そのまま動かす */
export function withVisitor<T>(key: string | null, fn: () => T): T {
  if (!visitorsOn() || !key) return fn();
  return als.run({ key: isVisitorKey(key) ? key : NO_VISITOR }, fn);
}

/** 裏で続く処理を始める前に呼ぶ：今の人で固定して動かす（要求が終わったあとも、別の人の場所に書かない） */
export function withCurrentVisitor<T>(fn: () => T): T {
  return withVisitor(currentVisitorKey(), fn);
}

/**
 * 実行時のファイルの場所を、今の人の場所に移す（見せる用だけ）。すでに今の人の場所の中なら、そのまま。
 * 見せる用の置き場の中なら同じ相対の場所に、外なら名前だけを今の人の場所に置く（見せる用では、人の場所の外に書かない）
 */
export function scopedFile(p: string): string {
  const key = currentVisitorKey();
  if (!key) return p;
  const dir = ensureVisitor(key);
  const abs = path.resolve(p);
  const relToDir = path.relative(dir, abs);
  if (!relToDir.startsWith("..") && !path.isAbsolute(relToDir)) return abs;
  const rel = path.relative(shareBaseDir(), abs);
  if (!rel.startsWith("..") && !path.isAbsolute(rel) && !rel.startsWith(`visitors${path.sep}`)) return path.join(dir, rel);
  return path.join(dir, path.basename(abs));
}

/** 今の人の実行時のデータの置き場所（見せる用でなければ null） */
export function scopedRuntimeRoot(): string | null {
  const key = currentVisitorKey();
  return key ? ensureVisitor(key) : null;
}

// ---------------------------------------------------------------------------
// 人の場所を作る・使った時刻を残す・上限と片付け
// ---------------------------------------------------------------------------
const LAST_USED = ".last_used";
const TOUCH_EVERY_MS = 60_000;
const SWEEP_EVERY_MS = 10 * 60_000;
type State = { touched: Map<string, number>; lastSweep: number };
const g = globalThis as typeof globalThis & { __visitorState?: State };
const state = (): State => (g.__visitorState ??= { touched: new Map(), lastSweep: 0 });

export function visitorMax(): number {
  const n = Number((process.env.VISITOR_MAX ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : 200;
}
export function visitorIdleMs(): number {
  const n = Number((process.env.VISITOR_IDLE_HOURS ?? "").trim());
  return (Number.isFinite(n) && n > 0 ? n : 12) * 3600_000;
}

function lastUsedMs(dir: string): number {
  try {
    return fs.statSync(/*turbopackIgnore: true*/ path.join(dir, LAST_USED)).mtimeMs;
  } catch {
    try {
      return fs.statSync(/*turbopackIgnore: true*/ dir).mtimeMs;
    } catch {
      return 0;
    }
  }
}

/** 人の場所の一覧（名前と、最後に使った時刻） */
export function listVisitors(): Array<{ key: string; last_used_ms: number }> {
  let names: string[] = [];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ visitorsDir());
  } catch {
    return [];
  }
  return names.filter(isVisitorKey).map((key) => ({ key, last_used_ms: lastUsedMs(path.join(visitorsDir(), key)) }));
}

/**
 * 片付け：一定時間使われていない人の場所を消す。そのうえで上限以上なら、いちばん長く使われていない場所から消して、新しい1人分を空ける。
 * keep の場所は消さない（今の人）。消した名前を返す
 */
export function sweepVisitors(opts: { keep?: string; makeRoomFor?: number } = {}): string[] {
  const now = Date.now();
  const removed: string[] = [];
  const rm = (key: string) => {
    try {
      fs.rmSync(/*turbopackIgnore: true*/ path.join(visitorsDir(), key), { recursive: true, force: true });
      state().touched.delete(key);
      removed.push(key);
    } catch (e) {
      console.error(`[人の場所の片付け] ${key} を消せませんでした（${e instanceof Error ? e.message : "不明なエラー"}）`);
    }
  };
  let list = listVisitors().filter((v) => v.key !== opts.keep);
  for (const v of list) if (now - v.last_used_ms > visitorIdleMs()) rm(v.key);
  list = listVisitors().filter((v) => v.key !== opts.keep).sort((a, b) => a.last_used_ms - b.last_used_ms);
  const room = opts.makeRoomFor ?? 0;
  let count = listVisitors().length;
  for (const v of list) {
    if (count + room <= visitorMax()) break;
    rm(v.key);
    count--;
  }
  state().lastSweep = now;
  if (removed.length) console.log(`[人の場所の片付け] ${removed.length}人分を消しました（使われていない・上限 ${visitorMax()}人）`);
  return removed;
}

/** 人の場所を用意して返す（初めてなら作って、サンプルの依頼の保存済みの結果を入れる）。使った時刻を残す（1分に1回まで） */
export function ensureVisitor(key: string): string {
  const dir = visitorDir(key);
  const st = state();
  const now = Date.now();
  if (now - (st.touched.get(key) ?? 0) < TOUCH_EVERY_MS && fs.existsSync(/*turbopackIgnore: true*/ dir)) return dir;
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    sweepVisitors({ keep: key, makeRoomFor: 1 });
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
    try {
      seedVisitor(dir);
    } catch (e) {
      console.error(`[人の場所] 保存済みの結果を入れられませんでした（${e instanceof Error ? e.message : "不明なエラー"}）。空のまま続けます`);
    }
  } else if (now - st.lastSweep > SWEEP_EVERY_MS) {
    sweepVisitors({ keep: key });
  }
  try {
    const f = path.join(dir, LAST_USED);
    fs.writeFileSync(/*turbopackIgnore: true*/ f, new Date(now).toISOString());
  } catch {
    // 使った時刻が残せなくても続ける（片付けが少し早くなるだけ）
  }
  st.touched.set(key, now);
  return dir;
}

// ---------------------------------------------------------------------------
// 初期データ：サンプルの依頼に、保存済みの結果（docs/eval_latest.json）を「準備済み」として入れる
// ---------------------------------------------------------------------------
export const SEED_NOTE = "保存済みの結果です。自分の依頼を貼ると本物の AI が動きます";
export const SEED_FILE = "sample_proposals.json";

/** 保存済みの評価の結果のファイル（テストでは EVAL_LATEST_FILE で差し替える） */
const evalLatestFile = () => process.env.EVAL_LATEST_FILE || path.join(process.cwd(), "docs", "eval_latest.json");

function seedVisitor(dir: string) {
  const f = evalLatestFile();
  if (!fs.existsSync(/*turbopackIgnore: true*/ f)) return;
  const j = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ f, "utf-8")) as {
    at?: string;
    rows?: Array<{ request_id?: string; result?: unknown; run_usd?: number }>;
  };
  const out: Record<string, unknown> = {};
  for (const r of j.rows ?? []) {
    if (!r.request_id || !r.result || typeof r.result !== "object") continue;
    out[r.request_id] = {
      result: r.result,
      // 作業ログの最初に一言（画面の「Agent がやったこと」に出る）
      events: [{ type: "text", text: SEED_NOTE }],
      run_usd: 0, // この人が使った金額ではないので 0
      saved_at: j.at ?? new Date().toISOString(),
      opened_at: null,
      seeded: true,
    };
  }
  if (!Object.keys(out).length) return;
  const target = path.join(dir, SEED_FILE);
  fs.writeFileSync(/*turbopackIgnore: true*/ target, JSON.stringify(out, null, 2) + "\n", "utf-8");
}
