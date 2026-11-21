// One click: adopt or drop a 新しいテーマ案（未確認） on a reviewed card.
import { resolvePendingTheme } from "@/lib/cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as { card_id: string; theme: string; accept: boolean };
  const out = resolvePendingTheme(body.card_id, body.theme, !!body.accept);
  if (!out.ok) return Response.json({ error: out.errors.join(" / ") }, { status: 400 });
  return Response.json({ ok: true, card: out.card });
}
