// POST /api/cards/reactions：イベント後の反応の提案（反応のまとめ・需要あり）を1クリックで採用／見送り
import { resolveReaction } from "@/lib/surveys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { card_id?: string; reaction_id?: string; accept?: boolean } | null;
  if (!body?.card_id || !body.reaction_id) return Response.json({ error: "card_id と reaction_id が必要です" }, { status: 400 });
  const out = resolveReaction(body.card_id, body.reaction_id, !!body.accept);
  if (!out.ok) return Response.json({ error: out.error }, { status: 400 });
  return Response.json({ ok: true, card: out.card });
}
