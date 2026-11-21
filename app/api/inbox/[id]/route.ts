// GET /api/inbox/{id} → { id, status, summary?, url }（形は docs/inbox-api.md のとおりで、変えない）
import { getInboxItem, publicView } from "@/lib/inbox";
import { forbidden, isLocalRequest } from "@/lib/localOnly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(req)) return forbidden();
  const { id } = await params;
  const it = getInboxItem(id);
  if (!it) return Response.json({ error: "その依頼は受信箱にありません" }, { status: 404 });
  return Response.json(publicView(it, new URL(req.url).origin));
}
