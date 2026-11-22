import { pendingEmployees } from "@/lib/notebook";
import { chooseModels } from "@/lib/usage";
import { traceAllowed } from "@/lib/traceAccess";
import { REASON_CODES } from "@/lib/feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  // trace_allowed：実行の記録の画面を開けるか（見せる用では、この端末からだけ。lib/traceAccess.ts）
  // feedback_reasons：使われた結果の理由の選択肢（記録の側 lib/feedback.ts の REASON_CODES をそのまま。画面はこれを出す）
  return Response.json({ models: chooseModels(), pending_employees: pendingEmployees().length, trace_allowed: traceAllowed(req), feedback_reasons: REASON_CODES });
}
