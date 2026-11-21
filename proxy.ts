// すべてのリクエストの入口（Next.js 16 の Proxy。Node.js で動く）。中身の決まりは lib/share.ts
// - 既定：Host と Origin が localhost／127.0.0.1 のときだけ受け付ける
// - SHARE_MODE=lan：合言葉（ACCESS_CODE）を入れた人だけ。画面は合言葉の入力へ、/api は 401
// - SHARE_BUDGET_USD：見せている間の API 代の上限。超えたら API を使う操作を止める（429、理由つき）
import { NextResponse, type NextRequest } from "next/server";
import { usage } from "@/lib/data";
import { ACCESS_COOKIE, ACCESS_HEADER, checkBudget, checkRequest, shareBudgetUsd, spendsApi, spentSince } from "@/lib/share";

/** 見せている間の始まり：scripts/serve.mjs が起動時に入れる。直接 next を起動したときは、この入口を最初に読んだとき */
const STARTED_AT = process.env.SHARE_STARTED_AT || new Date().toISOString();

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const gate = checkRequest({
    method: req.method,
    pathname,
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    forwardedFor: req.headers.get("x-forwarded-for"),
    cookie: req.cookies.get(ACCESS_COOKIE)?.value ?? null,
    headerCode: req.headers.get(ACCESS_HEADER),
  });
  if (!gate.ok) {
    if (gate.redirectTo) return NextResponse.redirect(new URL(gate.redirectTo, req.url), 303);
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (shareBudgetUsd() !== null && spendsApi(req.method, pathname)) {
    const budget = checkBudget(req.method, pathname, spentSince(usage(), STARTED_AT));
    if (!budget.ok) return NextResponse.json({ error: budget.error }, { status: budget.status });
  }
  return NextResponse.next();
}

export const config = {
  // 画面と /api のすべて（Next.js の静的ファイルとアイコンは除く）
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
