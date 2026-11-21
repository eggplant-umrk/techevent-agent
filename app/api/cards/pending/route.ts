// One click: adopt or drop a 新しいテーマ案（未確認） on a reviewed card.
import { resolvePendingTheme } from "@/lib/cards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { card_id: string; theme: string; accept: boolean } | null;
  if (!body || typeof body !== "object" || typeof body.card_id !== "string" || typeof body.theme !== "string") {
    return Response.json({ error: "送られた内容が読めません" }, { status: 400 });
  }
  const out = resolvePendingTheme(body.card_id, body.theme, !!body.accept);
  if (!out.ok) return Response.json({ error: out.errors.join(" / ") }, { status: 400 });
  return Response.json({ ok: true, card: out.card });
}
