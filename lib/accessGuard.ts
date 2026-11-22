// 合言葉（見せる用、SHARE_MODE=lan）を続けて間違えたら、しばらく受け付けない。
//   - 同じ送り元：5分の間に5回間違えたら、そこから5分はその送り元の合言葉を受け付けない（正しい合言葉でも 429）
//   - 全体：送り元に関係なく、5分の間の間違いが合計30回を超えたら、そこから1分はだれの合言葉も受け付けない
//     （送り元を変えながら当てに来るのを止める。合言葉で入っている人〔印の cookie がある人〕は、ここを通らないので止まらない）
//   - 送り元は x-forwarded-for の最初の値。見せる用（npm run start:share）は scripts/serve.mjs が接続そのもの（ソケット）の値に
//     置き換えるので偽れない（SHARE_TRUSTED_SOURCE=1）。ほかの起動のしかたでは偽れるので、全体の上限が頼り
//   - 正しい合言葉で入れたら、その送り元の回数は戻す
//   - 入口（proxy.ts）と合言葉の窓口（/api/access）は別々に読み込まれることがあるので、記録はプロセスに1つ（globalThis）に置く
//   - 記録はメモリだけ（サーバーを起動し直すと消える）
export const ACCESS_FAIL_LIMIT = 5;
export const ACCESS_FAIL_WINDOW_MS = 5 * 60_000;
export const ACCESS_LOCK_MS = 5 * 60_000;
/** 全体：この回数を超えたら（31回目で）止める */
export const ACCESS_GLOBAL_FAIL_LIMIT = 30;
export const ACCESS_GLOBAL_WINDOW_MS = 5 * 60_000;
export const ACCESS_GLOBAL_LOCK_MS = 60_000;

interface Entry {
  fails: number[];
  lockedUntil: number;
}
interface Store {
  bySource: Map<string, Entry>;
  all: number[];
  allLockedUntil: number;
}
const g = globalThis as typeof globalThis & { __netachoAccessGuard?: Store };
const store = (): Store => (g.__netachoAccessGuard ??= { bySource: new Map(), all: [], allLockedUntil: 0 });

/** 送り元（x-forwarded-for の最初の IP）。分からなければ「不明」 */
export function accessSourceKey(forwardedFor: string | null | undefined): string {
  const first = (forwardedFor ?? "").split(",")[0]?.trim().toLowerCase();
  return first ? first.slice(0, 64) : "不明";
}

export interface AccessLock {
  /** 残りの時間（ms） */
  ms: number;
  /** source：その送り元だけ ／ all：全体 */
  scope: "source" | "all";
  message: string;
}

function lockOf(scope: AccessLock["scope"], ms: number): AccessLock {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  const message =
    scope === "all"
      ? `合言葉の間違いが続いているため、しばらく受け付けません。${min}分ほど待ってから入れてください`
      : `合言葉を続けて間違えたので、しばらく受け付けません。${min}分ほど待ってから入れてください`;
  return { ms, scope, message };
}

/** 受け付けないなら、その理由と残りの時間。受け付けるなら null（全体の止めを先に見る） */
export function accessLock(key: string, now = Date.now()): AccessLock | null {
  const s = store();
  if (s.allLockedUntil > now) return lockOf("all", s.allLockedUntil - now);
  const e = s.bySource.get(key);
  return e && e.lockedUntil > now ? lockOf("source", e.lockedUntil - now) : null;
}

/** 受け付けない残りの時間（ms）。受け付けるなら 0 */
export const accessLockedMs = (key: string, now = Date.now()) => accessLock(key, now)?.ms ?? 0;

/** 間違えた1回を数える。これで受け付けなくなったら、その理由 */
export function noteAccessFailure(key: string, now = Date.now()): AccessLock | null {
  const s = store();
  // 古い記録は捨てる（たまり続けないように）
  if (s.bySource.size > 1000)
    for (const [k, v] of s.bySource) if (v.lockedUntil <= now && !v.fails.some((t) => now - t < ACCESS_FAIL_WINDOW_MS)) s.bySource.delete(k);
  const e = s.bySource.get(key) ?? { fails: [], lockedUntil: 0 };
  e.fails = [...e.fails.filter((t) => now - t < ACCESS_FAIL_WINDOW_MS), now];
  if (e.fails.length >= ACCESS_FAIL_LIMIT) {
    e.lockedUntil = now + ACCESS_LOCK_MS;
    e.fails = [];
  }
  s.bySource.set(key, e);
  // 全体の数（送り元に関係なく）
  s.all = [...s.all.filter((t) => now - t < ACCESS_GLOBAL_WINDOW_MS), now];
  if (s.all.length > ACCESS_GLOBAL_FAIL_LIMIT) {
    s.allLockedUntil = now + ACCESS_GLOBAL_LOCK_MS;
    s.all = [];
  }
  return accessLock(key, now);
}

/** 正しい合言葉で入れたら、その送り元の回数を戻す（全体の数は戻さない） */
export function noteAccessSuccess(key: string): void {
  store().bySource.delete(key);
}

/** 受け付けないときの文（その送り元を止めたとき） */
export const accessLockedMessage = (ms: number) => lockOf("source", ms).message;

/** テスト用 */
export function clearAccessGuard(): void {
  const s = store();
  s.bySource.clear();
  s.all = [];
  s.allLockedUntil = 0;
}
