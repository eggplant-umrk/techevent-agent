import { draftOutreach } from "@/lib/heavy";
import { resolveRequest } from "@/lib/requests";
import { draftCandidate, saveDraft } from "@/lib/board";
import { activities } from "@/lib/data";
import { runUsd, totalUsd } from "@/lib/usage";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";

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
    const r = await draftOutreach(String(body.run_id ?? "").slice(0, 100) || `draft-${request.id}`, request, candidate);
    // 承諾済みの依頼を開き直したときに主催者への返事を出せるよう、下書きを保存する（送信はしない）
    if (body.request_id && !body.custom_text) saveDraft(body.request_id, candidate.employee_id, r.value);
    return Response.json({
      draft: r.value,
      model: r.model,
      fell_back: r.fellBack,
      run_usd: runUsd(body.run_id),
      total_usd: totalUsd(),
    });
  } catch (err) {
    return Response.json({ error: userErrorText(err, { where: "下書き" }) }, { status: 500 });
  }
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
export const POST = slotted(handlePost);
