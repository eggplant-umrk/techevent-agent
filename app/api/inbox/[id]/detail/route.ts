// 画面用：受信箱の1件を、保存した候補と作業ログつきで返す（窓口の GET /api/inbox/{id} とは別）
import { detailView, getInboxItem } from "@/lib/inbox";
import { forbidden, isLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(req)) return forbidden();
  const { id } = await params;
  const it = getInboxItem(id);
  if (!it) return Response.json({ error: "その依頼は受信箱にありません" }, { status: 404 });
  return Response.json(detailView(it));
}
