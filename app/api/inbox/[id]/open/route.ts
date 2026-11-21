// 画面用：開いた依頼に印を付ける（「新しい依頼」の印を外す）
import { getInboxItem, markOpened } from "@/lib/inbox";
import { isSampleRequest, markSampleOpened } from "@/lib/board";
import { forbidden, isLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(req)) return forbidden();
  const { id } = await params;
  if (isSampleRequest(id)) {
    markSampleOpened(id);
    return Response.json({ ok: true });
  }
  if (!getInboxItem(id)) return Response.json({ error: "その依頼は受信箱にありません" }, { status: 404 });
  markOpened(id);
  return Response.json({ ok: true });
}
