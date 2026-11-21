// ネタ帳タブ：人の一覧（社員全員。カードのない人も出す）
import { peopleRows } from "@/lib/people";

import { loadCalendarIfConfigured } from "@/lib/busyness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await loadCalendarIfConfigured(); // iCal を使う設定のときだけ（本人の予定）
  return Response.json({ people: peopleRows() });
}
