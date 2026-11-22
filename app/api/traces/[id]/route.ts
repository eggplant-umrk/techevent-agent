// GET /api/traces/{依頼のid}：その依頼の実行の記録（画面の「この依頼の記録」）。読むのは記録の側（③）の getTrace
//   - 見せる用（SHARE_MODE=lan）では、この端末（127.0.0.1）からだけ（lib/traceAccess.ts）。会場の端末からは 403
//   - 記録がなければ 404（画面は「この依頼の記録はまだありません」）
//   - 記録には名前・時間・数・成否だけが入っている（指示文・会話の原文・ツールの入出力は入っていない）
import { getTrace } from "@/lib/trace";
import { traceAllowed } from "@/lib/traceAccess";
import { forbidden, isLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(req)) return forbidden();
  if (!traceAllowed(req)) return Response.json({ error: "この依頼の記録は、発表用の端末からだけ開けます" }, { status: 403 });
  const { id } = await params;
  if (!ID_RE.test(id)) return Response.json({ error: "送られた内容が読めません" }, { status: 400 });
  const trace = getTrace(id);
  if (!trace) return Response.json({ error: "この依頼の記録はまだありません" }, { status: 404 });
  return Response.json({ trace });
}
