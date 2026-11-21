// GET /api/events/{id}：イベントの詳細。登壇ごとの数字（コードで計算）、回答、分析結果
import { eventDetail } from "@/lib/surveys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = eventDetail(id);
  if (!d) return Response.json({ error: "そのイベントは見つかりません" }, { status: 404 });
  return Response.json(d);
}
