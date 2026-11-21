// 画面用：「依頼ではなさそう」と読んだ1件を、人が「依頼として進める」（AI の読み違いに備える）。候補づくりは裏で続く
// 不適切と読んだものは進めない（「この内容には対応しません」）
import { runAgent } from "@/lib/agent";
import { acquireApiSlotWait, apiBusyResponse } from "@/lib/apiSlots";
import { proceedAsRequest } from "@/lib/inbox";
import { forbidden, isLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(req)) return forbidden();
  const { id } = await params;
  // API を使う操作は同時に2件まで（lib/apiSlots.ts。空いていなければ最大60秒待つ）。候補づくりが裏で終わるまで1件分を持つ
  const release = await acquireApiSlotWait(req.signal);
  if (!release) return apiBusyResponse();
  const out = proceedAsRequest(id, (request, emit) => runAgent(request, emit), release);
  if (!out.ok) {
    release();
    return Response.json({ error: out.error }, { status: 400 });
  }
  return Response.json({ ok: true });
}
