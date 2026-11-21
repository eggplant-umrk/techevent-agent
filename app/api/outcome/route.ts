// record_outcome: write the result back to the card's outreach history (called from the UI).
// If the agent proposed someone without a card, approving creates a card from the proposal first.
import { appendOutreach, getCardById, upsertCard, type DeclineReason, type OutreachResult } from "@/lib/cards";
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

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  if (!RESULTS.includes(body.result)) return Response.json({ error: "result が不正です" }, { status: 400 });
  if (body.result === "declined" && (!body.reason || !REASONS.includes(body.reason))) {
    return Response.json({ error: "辞退の理由を選んでください" }, { status: 400 });
  }

  const request = resolveRequest(body);
  let cardId = body.card_id;
  if (!cardId) {
    const c = body.candidate;
    if (!c) return Response.json({ error: "カードがありません" }, { status: 400 });
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

  const card = appendOutreach(cardId, {
    request_id: body.request_id,
    result: body.result,
    reason: body.result === "declined" ? body.reason! : null,
    event_date: eventDateOf(request), // 受信箱の依頼は会話から確かめた日程
  });
  return Response.json({ ok: true, card });
}
