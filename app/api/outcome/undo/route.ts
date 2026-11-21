// 承諾の取り消し：カードの打診履歴から、その依頼の最後の記録（承諾・公開）を1つ戻す（画面の「承諾を取り消す」）。
//   POST { request_id, card_id } → { ok: true, card }
// 戻せるのは、その依頼の最後の記録が承諾か公開のときだけ（コードで確かめる）。声かけ・辞退は戻さない。
import { getCardById, removeOutreach } from "@/lib/cards";
import { forbidden, isLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return forbidden();
  const body = (await req.json().catch(() => null)) as { request_id?: unknown; card_id?: unknown } | null;
  if (!body || typeof body.request_id !== "string" || typeof body.card_id !== "string") {
    return Response.json({ error: "request_id と card_id（文字列）が必要です" }, { status: 400 });
  }
  const card = getCardById(body.card_id);
  if (!card) return Response.json({ error: "そのカードはありません" }, { status: 404 });
  const last = card.outreach_history.filter((h) => h.request_id === body.request_id).pop();
  if (!last || (last.result !== "accepted" && last.result !== "published")) {
    return Response.json({ error: "この依頼の最後の記録は承諾ではないため、取り消せません" }, { status: 400 });
  }
  removeOutreach(card.card_id, body.request_id);
  return Response.json({ ok: true, card: getCardById(card.card_id) });
}
