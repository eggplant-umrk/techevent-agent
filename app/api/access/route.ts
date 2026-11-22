// POST /api/access：合言葉を確かめて、ブラウザに印（cookie、httpOnly）を付ける（SHARE_MODE=lan のときだけ使う）
//   { code: string } → 200 { ok: true } ／ 401 ／ 429（同じ送り元が続けて間違えたとき・全体の間違いが多いとき。lib/accessGuard.ts）
import { ACCESS_COOKIE, accessToken, codeMatches, shareMode } from "@/lib/share";
import { accessLock, accessSourceKey, noteAccessFailure, noteAccessSuccess } from "@/lib/accessGuard";
import { newPersonId, personCookieHeader, personCookieOf } from "@/lib/personBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (shareMode() !== "lan") return Response.json({ error: "合言葉は使っていません（同じ端末からだけ使う設定です）" }, { status: 400 });
  const key = accessSourceKey(req.headers.get("x-forwarded-for"));
  // 続けて間違えた送り元・全体の間違いが多いときは、合言葉を見ずに断る
  const locked = accessLock(key);
  if (locked) return Response.json({ error: locked.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(locked.ms / 1000)) } });
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : null;
  if (!codeMatches(code)) {
    const nowLocked = noteAccessFailure(key);
    if (nowLocked) return Response.json({ error: nowLocked.message }, { status: 429 });
    return Response.json({ error: "合言葉が違います" }, { status: 401 });
  }
  noteAccessSuccess(key);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${ACCESS_COOKIE}=${accessToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 12}`);
  // 人ごとの印（1人あたりの API 代の上限を数えるため。合言葉の印は全員同じ値なので別に付ける）。もう持っていれば変えない
  if (!personCookieOf(req.headers.get("cookie"))) res.headers.append("Set-Cookie", personCookieHeader(newPersonId()));
  return res;
}
