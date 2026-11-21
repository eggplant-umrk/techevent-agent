// カード → 出し先を探す。作業ログを NDJSON で流す（依頼 → 候補の /api/agent と同じ流し方）
import { getCardById } from "@/lib/cards";
import { findVenues, type VenueEvent } from "@/lib/venues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { card_id?: string } | null;
  if (!body?.card_id || !getCardById(body.card_id)) return Response.json({ error: "カードが見つかりません" }, { status: 400 });
  const cardId = body.card_id;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: VenueEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await findVenues(cardId, emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "不明なエラー" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
