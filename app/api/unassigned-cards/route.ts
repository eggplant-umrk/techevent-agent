// 担当者未定のネタ（リリースノートから作った、担当者が決まっていないカード）の一覧。lib/releaseCards.ts
// 画面（ネタ帳での一覧と割り当て）は別の担当。ここは窓口だけ。
import { listUnassigned } from "@/lib/releaseCards";
import { forbidden, isLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  if (!isLocalRequest(req)) return forbidden();
  return Response.json({ cards: listUnassigned() });
}
