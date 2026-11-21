import { draftOutreach } from "@/lib/heavy";
import { resolveRequest } from "@/lib/requests";
import { saveDraft } from "@/lib/board";
import { runUsd, totalUsd } from "@/lib/usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Body {
  run_id: string;
  request_id?: string;
  custom_text?: string;
  candidate: { employee_id: string; theme: string; reason: string; evidence_activity_ids: string[] };
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const request = resolveRequest(body);
  if (!request || !body.candidate?.employee_id) {
    return Response.json({ error: "依頼または候補がありません" }, { status: 400 });
  }
  try {
    const r = await draftOutreach(body.run_id, request, body.candidate);
    // 承諾済みの依頼を開き直したときに主催者への返事を出せるよう、下書きを保存する（送信はしない）
    if (body.request_id && !body.custom_text) saveDraft(body.request_id, body.candidate.employee_id, r.value);
    return Response.json({
      draft: r.value,
      model: r.model,
      fell_back: r.fellBack,
      run_usd: runUsd(body.run_id),
      total_usd: totalUsd(),
    });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "不明なエラー" }, { status: 500 });
  }
}
