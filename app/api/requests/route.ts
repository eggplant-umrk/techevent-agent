import { isPast } from "@/lib/archive";
import { requests } from "@/lib/data";

export const dynamic = "force-dynamic";

/** サンプルの依頼。開催日が過ぎたものはアーカイブへ回す（判定はコード） */
export function GET() {
  return Response.json(requests().filter((r) => !isPast(r.event?.date)));
}
