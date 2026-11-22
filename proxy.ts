// すべてのリクエストの入口（Next.js 16 の Proxy。Node.js で動く）。中身の決まりは lib/share.ts
// - 既定：Host と Origin が localhost／127.0.0.1 のときだけ受け付ける
// - SHARE_MODE=lan：合言葉（ACCESS_CODE）を入れた人だけ。画面は合言葉の入力へ、/api は 401
// - 合言葉を同じところから続けて間違えたら（5回）、しばらく（5分）受け付けない（lib/accessGuard.ts）
// - SHARE_BUDGET_USD：見せている間の API 代の上限。超えたら API を使う操作を止める（429、理由つき）
// - SHARE_PER_PERSON_USD：見せる用の1人あたりの上限。超えたらその人だけ止める（lib/personBudget.ts。合計の上限はそのまま）
import { NextResponse, type NextRequest } from "next/server";
import { usage } from "@/lib/data";
import { ACCESS_COOKIE, ACCESS_HEADER, accessToken, checkBudget, checkRequest, codeMatches, shareBudgetUsd, shareMode, spendsApi, spentSince, withoutDebug } from "@/lib/share";
import { accessLock, accessSourceKey, noteAccessFailure, noteAccessSuccess } from "@/lib/accessGuard";
import { checkPerson, newPersonId, PERSON_COOKIE, personCookieHeader, personKey, visitorKeyOf } from "@/lib/personBudget";

/** 見せている間の始まり：scripts/serve.mjs が起動時に入れる。直接 next を起動したときは、この入口を最初に読んだとき */
const STARTED_AT = process.env.SHARE_STARTED_AT || new Date().toISOString();

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 合言葉をヘッダーで送ってきたとき（印〔cookie〕のない人）：続けて間違えたところは、しばらく受け付けない
  const headerCode = req.headers.get(ACCESS_HEADER);
  const cookie = req.cookies.get(ACCESS_COOKIE)?.value ?? null;
  const checksHeader = shareMode() === "lan" && !!headerCode && cookie !== accessToken();
  const source = accessSourceKey(req.headers.get("x-forwarded-for"));
  if (checksHeader) {
    const locked = accessLock(source);
    if (locked) return NextResponse.json({ error: locked.message }, { status: 429, headers: { "Retry-After": String(Math.ceil(locked.ms / 1000)) } });
  }
  const gate = checkRequest({
    method: req.method,
    pathname,
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    forwardedFor: req.headers.get("x-forwarded-for"),
    cookie,
    headerCode,
  });
  if (checksHeader) {
    if (codeMatches(headerCode)) noteAccessSuccess(source);
    else {
      const nowLocked = noteAccessFailure(source);
      if (nowLocked) return NextResponse.json({ error: nowLocked.message }, { status: 429 });
    }
  }
  if (!gate.ok) {
    if (gate.redirectTo) return NextResponse.redirect(new URL(gate.redirectTo, req.url), 303);
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  // 見せる用では ?debug（API 代の表示）を出さない：外した URL に移す
  if (shareMode() === "lan" && !pathname.startsWith("/api")) {
    const clean = withoutDebug(req.nextUrl);
    if (clean) return NextResponse.redirect(clean, 307);
  }
  if (shareBudgetUsd() !== null && spendsApi(req.method, pathname)) {
    const budget = checkBudget(req.method, pathname, spentSince(usage(), STARTED_AT));
    if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: budget.status });
  }
  if (shareMode() === "lan") {
    // 1人あたりの API 代の上限（SHARE_PER_PERSON_USD）：人ごとの印（nb_person）で数え、超えたらその人だけ止める
    let personId = req.cookies.get(PERSON_COOKIE)?.value ?? null;
    let issued: string | null = null;
    if (!personId && cookie === accessToken()) {
      // 合言葉で入っているのに人の印がない（前に入った人など）：ここで付ける。この要求から、その印で数える
      personId = issued = newPersonId();
    }
    if (spendsApi(req.method, pathname)) {
      // 人の見分け方は visitorKeyOf（③の lib/visitor.ts が入ったら差し替える）。ここで印を付けたときはその印で
      const per = checkPerson(issued ? personKey(issued) : visitorKeyOf(req));
      if (!per.ok) return NextResponse.json({ error: per.error }, { status: per.status });
    }
    if (issued) {
      const headers = new Headers(req.headers);
      headers.set("cookie", [req.headers.get("cookie"), `${PERSON_COOKIE}=${issued}`].filter(Boolean).join("; "));
      const res = NextResponse.next({ request: { headers } });
      res.headers.append("Set-Cookie", personCookieHeader(issued));
      return res;
    }
  }
  return NextResponse.next();
}

export const config = {
  // 画面と /api のすべて（Next.js の静的ファイル・アイコン・フォント〔public/fonts/〕は除く。合言葉の画面でもフォントが読めるように）
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};
