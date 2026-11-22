import { draftOutreach } from "@/lib/heavy";
import { resolveRequest } from "@/lib/requests";
import { draftCandidate, loadDraft, saveDraft } from "@/lib/board";
import { activities } from "@/lib/data";
import { runUsd, totalUsd } from "@/lib/usage";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";
import { withTrace } from "@/lib/trace";
import { perPerson } from "@/lib/personBudget";
import { afterSlot } from "@/lib/shareGate";
import { forClient } from "@/lib/clientView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  run_id: string;
  request_id?: string;
  custom_text?: string;
  candidate: { employee_id: string; theme: string; reason: string; evidence_activity_ids: string[] };
}

async function handlePost(req: Request) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body) return Response.json({ error: "依頼または候補がありません" }, { status: 400 });
  const request = resolveRequest(body);
  // 候補の文（テーマ・理由・根拠）はブラウザから来たものを使わず、保存済みの候補から引き直す
  const candidate = request ? draftCandidate(body, new Set(activities().map((a) => a.id))) : null;
  if (!request || !candidate) {
    return Response.json({ error: "依頼または候補がありません（保存済みの候補にいない人の下書きは作りません）" }, { status: 400 });
  }
  try {
    const make = () => draftOutreach(String(body.run_id ?? "").slice(0, 100) || `draft-${request.id}`, request, candidate);
    // 実行の記録（lib/trace.ts）：依頼の id の記録に足す。その場で書いた依頼（custom_text）は残さない
    const r = body.request_id && !body.custom_text ? await withTrace(request.id, make) : await make();
    // 承諾済みの依頼を開き直したときに主催者への返事を出せるよう、下書きを保存する（送信はしない）
    if (body.request_id && !body.custom_text) saveDraft(body.request_id, candidate.employee_id, r.value);
    // 見せる用では合計（total_usd）を返さない
    return Response.json(forClient({
      draft: r.value,
      model: r.model,
      fell_back: r.fellBack,
      run_usd: runUsd(body.run_id),
      total_usd: totalUsd(),
    }));
  } catch (err) {
    return Response.json({ error: userErrorText(err, { where: "下書き" }) }, { status: 500 });
  }
}

/**
 * GET /api/draft?request_id=…&employee_id=… → { draft }（保存済みの下書き。なければ draft は null）
 * 依頼を開き直したときに、前に作った声かけ文・構成案・主催者への返事を出すため。作り直さない（API は使わない）
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const requestId = (q.get("request_id") ?? "").slice(0, 120);
  const employeeId = (q.get("employee_id") ?? "").slice(0, 40);
  if (!requestId || !employeeId) return Response.json({ error: "request_id と employee_id が要ります" }, { status: 400 });
  // 保存するときに足した saved_at は返さない
  const saved = loadDraft(requestId, employeeId) as (Record<string, unknown> & { saved_at?: string }) | null;
  if (!saved) return Response.json({ draft: null });
  const { saved_at: _savedAt, ...draft } = saved;
  return Response.json({ draft });
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
// 見せる用：使った API 代を、要求した人に足す（1人あたりの上限。lib/personBudget.ts）
// 枠を取った直後にもう一度上限を見る（afterSlot。lib/shareGate.ts）
export const POST = perPerson(slotted(afterSlot(handlePost)));
