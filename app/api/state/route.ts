import { pendingEmployees } from "@/lib/notebook";
import { chooseModels } from "@/lib/usage";
import { traceAllowed } from "@/lib/traceAccess";
import { REASON_CODES } from "@/lib/feedback";
import { shareMode } from "@/lib/share";
import { perPersonUsd, personRemaining, roleOf, visitorKeyOf } from "@/lib/personBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  // trace_allowed：実行の記録の画面を開けるか（lib/traceAccess.ts。見せる用でも開ける）
  // feedback_reasons：使われた結果の理由の選択肢（記録の側 lib/feedback.ts の REASON_CODES をそのまま。画面はこれを出す）
  // share：見せる用（SHARE_MODE=lan）のときだけ。その人の残り（1人あたりの上限があるとき）
  // 役割（メンターなら上限が SHARE_MENTOR_USD）は数えるのに使うだけで、画面には出さない
  const role = roleOf(req);
  const limit = perPersonUsd(role);
  const share = shareMode() === "lan" ? { person_limit_usd: limit, person_remaining_usd: limit === null ? null : personRemaining(visitorKeyOf(req), role) } : null;
  return Response.json({ models: chooseModels(), pending_employees: pendingEmployees().length, trace_allowed: traceAllowed(req), feedback_reasons: REASON_CODES, share });
}
