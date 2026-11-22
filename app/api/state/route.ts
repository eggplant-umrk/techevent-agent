import { pendingEmployees } from "@/lib/notebook";
import { chooseModels } from "@/lib/usage";
import { traceAllowed } from "@/lib/traceAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  // trace_allowed：実行の記録の画面を開けるか（見せる用では、この端末からだけ。lib/traceAccess.ts）
  return Response.json({ models: chooseModels(), pending_employees: pendingEmployees().length, trace_allowed: traceAllowed(req) });
}
