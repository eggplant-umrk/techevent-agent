import type { DeclineReason, OutcomeResult } from "@/lib/data";
import { resolveRequest } from "@/lib/requests";
import { recordOutcome } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REASONS: DeclineReason[] = ["theme_mismatch", "busy", "schedule_conflict", "other"];

export async function POST(req: Request) {
  const body = (await req.json()) as {
    request_id: string;
    custom_text?: string;
    employee_id: string;
    result: OutcomeResult;
    reason?: DeclineReason;
    note?: string;
    theme?: string;
  };
  if (body.result !== "accepted" && body.result !== "declined") {
    return Response.json({ error: "result は accepted か declined" }, { status: 400 });
  }
  if (body.result === "declined" && (!body.reason || !REASONS.includes(body.reason))) {
    return Response.json({ error: "辞退の理由を選んでください" }, { status: 400 });
  }
  const request = resolveRequest(body);
  const entry = recordOutcome({
    request_id: body.request_id,
    employee_id: body.employee_id,
    result: body.result,
    reason: body.reason ?? null,
    note: (body.note ?? "").slice(0, 500),
    event_date: request?.event?.date ?? null,
    theme: body.theme ?? null,
  });
  return Response.json({ ok: true, entry });
}
