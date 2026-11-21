// POST /api/access：合言葉を確かめて、ブラウザに印（cookie、httpOnly）を付ける（SHARE_MODE=lan のときだけ使う）
//   { code: string } → 200 { ok: true } ／ 401 ／ 429（同じところから続けて間違えたとき。lib/accessGuard.ts）
import { ACCESS_COOKIE, accessToken, codeMatches, shareMode } from "@/lib/share";
import { accessLockedMessage, accessLockedMs, accessSourceKey, noteAccessFailure, noteAccessSuccess } from "@/lib/accessGuard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (shareMode() !== "lan") return Response.json({ error: "合言葉は使っていません（同じ端末からだけ使う設定です）" }, { status: 400 });
  const key = accessSourceKey(req.headers.get("x-forwarded-for"));
  const locked = accessLockedMs(key);
  if (locked) return Response.json({ error: accessLockedMessage(locked) }, { status: 429, headers: { "Retry-After": String(Math.ceil(locked / 1000)) } });
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : null;
  if (!codeMatches(code)) {
    if (noteAccessFailure(key)) return Response.json({ error: accessLockedMessage(accessLockedMs(key)) }, { status: 429 });
    return Response.json({ error: "合言葉が違います" }, { status: 401 });
  }
  noteAccessSuccess(key);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${ACCESS_COOKIE}=${accessToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 12}`);
  return res;
}
