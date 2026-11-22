// 画面用：受信箱の1件を、保存した候補と作業ログつきで返す（窓口の GET /api/inbox/{id} とは別）
import { boardDetail } from "@/lib/board";
import { forbidden, isLocalRequest } from "@/lib/localOnly";
import { forClient } from "@/lib/clientView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(req)) return forbidden();
  const { id } = await params;
  // 受信箱に届いた依頼とサンプルの依頼の両方（依頼の状態つき）
  const d = boardDetail(id);
  if (!d) return Response.json({ error: "その依頼は受信箱にありません" }, { status: 404 });
  return Response.json(forClient(d)); // 見せる用では、保存した作業ログの合計（total_usd）を返さない
}
