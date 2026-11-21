// ネタ帳タブ：人の一覧（社員全員。カードのない人も出す）
import { peopleRows } from "@/lib/people";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ people: peopleRows() });
}
