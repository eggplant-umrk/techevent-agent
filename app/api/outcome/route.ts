// record_outcome: write the result back to the card's outreach history (called from the UI).
// If the agent proposed someone without a card, approving creates a card from the proposal first.
import { appendOutreach, getCardById, loadCards, upsertCard, type Card, type DeclineReason, type OutreachResult } from "@/lib/cards";
import { resolveRequest } from "@/lib/requests";
import { eventDateOf } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULTS: OutreachResult[] = ["approved", "accepted", "declined", "published"];
const REASONS: DeclineReason[] = ["theme_mismatch", "busy", "schedule_conflict", "other"];

interface Body {
  request_id: string;
  custom_text?: string;
  card_id: string | null;
  result: OutreachResult;
  reason?: DeclineReason;
  /** Needed only when card_id is null. */
  candidate?: { employee_id: string; theme: string; reason: string; evidence_activity_ids: string[] };
}

/** その依頼での、このカードの最後の記録 */
const lastFor = (card: Card, requestId: string) => card.outreach_history.filter((h) => h.request_id === requestId).pop();

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body !== "object" || typeof body.request_id !== "string") {
    return Response.json({ error: "送られた内容が読めません" }, { status: 400 });
  }
  if (!RESULTS.includes(body.result)) return Response.json({ error: "result が不正です" }, { status: 400 });
  if (body.result === "declined" && (!body.reason || !REASONS.includes(body.reason))) {
    return Response.json({ error: "辞退の理由を選んでください" }, { status: 400 });
  }

  const request = resolveRequest(body);
  let cardId = body.card_id;
  if (!cardId) {
    const c = body.candidate;
    if (!c || typeof c.employee_id !== "string") return Response.json({ error: "カードがありません" }, { status: 400 });
    // 2つのタブで同時に承認しても、カードを2枚作らない：同じ人で、この依頼の記録か根拠を持つカードがあればそれを使う
    // （ここから記録までは await を挟まないので、同じプロセスの中では割り込まれない）
    const existing = loadCards().find(
      (k) => k.employee_id === c.employee_id && (k.evidence_request_ids.includes(body.request_id) || k.outreach_history.some((h) => h.request_id === body.request_id)),
    );
    if (existing) cardId = existing.card_id;
  }
  if (!cardId) {
    const c = body.candidate!;
    // A nominee may have no activity on the theme; the request that named them is the evidence.
    // Decided here from the stored request, not from anything the browser sends.
    const isNominee = !!request?.nominated_employee_id && request.nominated_employee_id === c.employee_id;
    const noActivity = !c.evidence_activity_ids?.length;
    const made = upsertCard({
      card_id: null,
      employee_id: c.employee_id,
      summary: c.reason,
      themes: [c.theme],
      evidence_activity_ids: c.evidence_activity_ids ?? [],
      format: "lt",
      format_reason: isNominee && noActivity ? "指名の依頼から作成したカード（根拠は依頼そのもの）" : "依頼への提案から作成したカード",
      published_ids: [],
      announcement_activity_ids: [],
      evidence_request_ids: isNominee ? [request!.id] : [],
    });
    if (!made.ok) return Response.json({ error: made.errors.join(" / ") }, { status: 400 });
    cardId = made.card!.card_id;
  } else if (!getCardById(cardId)) {
    return Response.json({ error: `カード ${cardId} は存在しません` }, { status: 400 });
  }

  // 最後の記録と同じ結果（同じ人の承諾を2回など）は足さない。2つのタブ・2人で同時に押しても1件だけになる
  const reason = body.result === "declined" ? body.reason! : null;
  const before = getCardById(cardId)!;
  const last = lastFor(before, body.request_id);
  if (last && last.result === body.result && (last.reason ?? null) === reason) {
    return Response.json({ ok: true, card: before, duplicate: true });
  }

  const card = appendOutreach(cardId, {
    request_id: body.request_id,
    result: body.result,
    reason,
    event_date: eventDateOf(request), // 受信箱の依頼は会話から確かめた日程
  });
  return Response.json({ ok: true, card });
}
