// 画面用：受信箱の依頼の「もう一度探す」（準備済み・エラーのどちらからも）。lib/inbox.ts の restart で準備し直し、結果は受信箱に保存する。
// 候補づくりは裏で続く（画面は一覧の読み直しで終わったのを見る）。サンプルの依頼・その場で書いた依頼は、今までどおり /api/agent
import { runAgent } from "@/lib/agent";
import { withApiSlotHandoff } from "@/lib/apiSlots";
import { getInboxItem, restart } from "@/lib/inbox";
import { extractIntakeWithAgent } from "@/lib/intake";
import { forbidden, isLocalRequest } from "@/lib/localOnly";
import { perPerson } from "@/lib/personBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handlePost(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(req)) return forbidden();
  const { id } = await params;
  if (!getInboxItem(id)) return Response.json({ error: "その依頼は受信箱にありません" }, { status: 404 });
  // API を使う操作の同時実行の上限（lib/apiSlots.ts。空いていなければ最大60秒待つ）。候補づくりが裏で終わるまで1件分を持つ
  // 取ったあとに保存などが失敗したら（投げたら）、withApiSlotHandoff が枠を必ず返す
  return withApiSlotHandoff(req.signal, (release) => {
    const out = restart(id, (request, emit) => runAgent(request, emit), extractIntakeWithAgent, release);
    if (!out.ok) {
      release();
      return Response.json({ error: out.error }, { status: out.error === "準備中です" ? 409 : 400 });
    }
    return Response.json({ ok: true });
  });
}

// 見せる用：使った API 代（裏で続く候補づくりも）を、押した人に足す（1人あたりの上限。lib/personBudget.ts）
export const POST = perPerson(handlePost);
