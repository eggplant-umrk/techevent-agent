// 担当者未定のネタに、技術広報が担当者を割り当てる。その人の普通のカードになり、確認済みとして扱う（lib/releaseCards.ts）。
//   POST { card_id: "card-team-01", employee_id: "e011" } → { ok: true, card_id: "card-e011-02" }
import { assignUnassigned } from "@/lib/releaseCards";
import { forbidden, isLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return forbidden();
  const body = (await req.json().catch(() => null)) as { card_id?: unknown; employee_id?: unknown } | null;
  if (!body || typeof body.card_id !== "string" || typeof body.employee_id !== "string") {
    return Response.json({ error: "card_id と employee_id（文字列）が必要です" }, { status: 400 });
  }
  const out = assignUnassigned(body.card_id, body.employee_id);
  if (!out.ok) return Response.json({ error: out.errors.join(" / ") }, { status: 400 });
  return Response.json({ ok: true, card_id: out.card_id });
}
