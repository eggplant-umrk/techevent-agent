// 合言葉（見せる用、SHARE_MODE=lan）を同じところから続けて間違えたら、しばらく受け付けない。
//   - 5分の間に5回間違えたら、そこから5分は合言葉を受け付けない（正しい合言葉でも 429）
//   - 「同じところ」は、Next.js が付ける接続元の IP（x-forwarded-for。なければ「不明」を1つのところとして数える）
//   - 正しい合言葉で入れたら、そのところの回数は戻す
//   - 入口（proxy.ts）と合言葉の窓口（/api/access）は別々に読み込まれることがあるので、記録はプロセスに1つ（globalThis）に置く
//   - 記録はメモリだけ（サーバーを起動し直すと消える）
export const ACCESS_FAIL_LIMIT = 5;
export const ACCESS_FAIL_WINDOW_MS = 5 * 60_000;
export const ACCESS_LOCK_MS = 5 * 60_000;

interface Entry {
  fails: number[];
  lockedUntil: number;
}
const g = globalThis as typeof globalThis & { __netachoAccessFails?: Map<string, Entry> };
const store = (): Map<string, Entry> => (g.__netachoAccessFails ??= new Map());

/** 接続元（x-forwarded-for の最初の IP）。分からなければ「不明」 */
export function accessSourceKey(forwardedFor: string | null | undefined): string {
  const first = (forwardedFor ?? "").split(",")[0]?.trim().toLowerCase();
  return first ? first.slice(0, 64) : "不明";
}

/** 受け付けない残りの時間（ms）。受け付けるなら 0 */
export function accessLockedMs(key: string, now = Date.now()): number {
  const e = store().get(key);
  return e && e.lockedUntil > now ? e.lockedUntil - now : 0;
}

/** 間違えた1回を数える。これで受け付けなくなったら true */
export function noteAccessFailure(key: string, now = Date.now()): boolean {
  const s = store();
  // 古い記録は捨てる（たまり続けないように）
  if (s.size > 1000) for (const [k, v] of s) if (v.lockedUntil <= now && !v.fails.some((t) => now - t < ACCESS_FAIL_WINDOW_MS)) s.delete(k);
  const e = s.get(key) ?? { fails: [], lockedUntil: 0 };
  e.fails = [...e.fails.filter((t) => now - t < ACCESS_FAIL_WINDOW_MS), now];
  if (e.fails.length >= ACCESS_FAIL_LIMIT) {
    e.lockedUntil = now + ACCESS_LOCK_MS;
    e.fails = [];
  }
  s.set(key, e);
  return e.lockedUntil > now;
}

/** 正しい合言葉で入れたら、回数を戻す */
export function noteAccessSuccess(key: string): void {
  store().delete(key);
}

/** 受け付けないときの文（何分待てばよいか） */
export function accessLockedMessage(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return `合言葉を続けて間違えたので、しばらく受け付けません。${min}分ほど待ってから入れてください`;
}

/** テスト用 */
export function clearAccessGuard(): void {
  store().clear();
}
