// GET /api/events：過去イベントの一覧（新しい順）。アンケートの件数と、分析済みか
import { listEvents } from "@/lib/surveys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ events: listEvents() });
}
