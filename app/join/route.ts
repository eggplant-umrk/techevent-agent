// GET /join?code=合言葉：見せる用（SHARE_MODE=lan）に、合言葉を打たずに入るリンク（発表用の画面 /share-links でコピーする）。
//   - 一般の合言葉（Notion に貼る用）でも、メンター用の合言葉（メンター・審査員用。運営さんに渡す用）でも同じ。メンターならメンターの印も
//   - サーバーが合言葉を確かめて印（cookie）を渡し、合言葉の付いていないアドレス（/）に移す
//   - 守りは合言葉の画面（/api/access）と同じ：同じ送り元が続けて間違えたら・全体の間違いが多ければ、しばらく受け付けない（lib/accessGuard.ts）
//   - 合言葉をサーバーの記録に残さない（このファイルはアドレスを出力しない）。Referrer-Policy: no-referrer
//   - 違う・止められているときは、合言葉の画面（/access）に理由の印だけ付けて移す（合言葉は付けない）
import { ACCESS_COOKIE, ACCESS_PATH, accessToken, codeMatches, MENTOR_COOKIE, mentorCodeMatches, shareMode } from "@/lib/share";
import { accessLock, accessSourceKey, noteAccessFailure, noteAccessSuccess } from "@/lib/accessGuard";
import { mentorCookieHeader, newPersonId, personCookieHeader, personCookieOf } from "@/lib/personBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 移す先は、同じ場所のパスだけ（"/" か "/access?join=…"。ほかの場所には移さない・合言葉は付けない） */
function redirect(to: "/" | `${typeof ACCESS_PATH}?join=${"ng" | "locked"}`, cookies: string[] = []): Response {
  const headers = new Headers({
    Location: to,
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 303, headers });
}

export async function GET(req: Request) {
  // 発表用（この端末だけ）では使わない：合言葉なしでそのまま画面へ
  if (shareMode() !== "lan") return redirect("/");
  const key = accessSourceKey(req.headers.get("x-forwarded-for"));
  if (accessLock(key)) return redirect(`${ACCESS_PATH}?join=locked`);
  const code = new URL(req.url).searchParams.get("code");
  const mentor = mentorCodeMatches(code);
  if (!mentor && !codeMatches(code)) {
    noteAccessFailure(key);
    return redirect(`${ACCESS_PATH}?join=${accessLock(key) ? "locked" : "ng"}`);
  }
  noteAccessSuccess(key);
  // 入れたときの印：合言葉の印・人の印（持っていなければ）・メンターの印（メンターなら付け、一般なら外す）。リンクから来るので SameSite=Lax
  const lax = (c: string) => c.replace("SameSite=Strict", "SameSite=Lax");
  const cookies = [`${ACCESS_COOKIE}=${accessToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 12}`];
  if (!personCookieOf(req.headers.get("cookie"))) cookies.push(lax(personCookieHeader(newPersonId())));
  cookies.push(mentor ? lax(mentorCookieHeader()) : `${MENTOR_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  return redirect("/", cookies);
}
