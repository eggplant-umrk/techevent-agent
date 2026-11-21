// カード → 出し先を探す。作業ログを NDJSON で流す（依頼 → 候補の /api/agent と同じ流し方）
import { getCardById } from "@/lib/cards";
import { findVenues, type VenueEvent } from "@/lib/venues";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handlePost(req: Request) {
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
        emit({ type: "error", message: userErrorText(err, { where: "出し先" }) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
export const POST = slotted(handlePost);
