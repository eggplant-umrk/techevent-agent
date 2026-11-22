// "ネタ帳を更新": streams the work log as NDJSON. Only employees with new activities are read.
import { updateNotebook, type NotebookEvent } from "@/lib/notebook";
import { forClient } from "@/lib/clientView";
import { slotted } from "@/lib/apiSlots";
import { LAN_BLOCKED, shareMode } from "@/lib/share";
import { userErrorText } from "@/lib/userError";
import { perPerson, visitorKeyOf } from "@/lib/personBudget";
import { afterSlot } from "@/lib/shareGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// 更新は同時に1つだけ（2つ同時に動くと、同じ人の活動を2回読んで API 代が二重にかかり、カードも重なる）。
// 同じサーバーの中で数える（開発サーバーの読み直しでも消えないように globalThis に置く）
// 見せる用（SHARE_MODE=lan）では人ごとに1つ（ネタ帳は人ごとの置き場にあるので、ほかの人の更新を待たせない）。発表用は全員で1つ
const g = globalThis as typeof globalThis & { __notebookUpdatingKeys?: Set<string> };
const updating = () => (g.__notebookUpdatingKeys ??= new Set());
const busyKey = (req: Request | undefined) => (shareMode() === "lan" && req ? `visitor:${visitorKeyOf(req)}` : "all");
const NOTEBOOK_BUSY = "ネタ帳を更新中です。終わってから、もう一度押してください";

async function handlePost(req?: Request) {
  // 見せる用（SHARE_MODE=lan）では止める（入口の proxy.ts でも止めている）
  const blocked = shareMode() === "lan" ? LAN_BLOCKED.find((b) => b.path.test("/api/notebook")) : undefined;
  if (blocked) return Response.json({ error: blocked.reason }, { status: 403 });
  const key = busyKey(req);
  if (updating().has(key)) return Response.json({ error: NOTEBOOK_BUSY }, { status: 409 });
  updating().add(key);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: NotebookEvent) => controller.enqueue(encoder.encode(JSON.stringify(forClient(e)) + "\n"));
      try {
        await updateNotebook("pending", emit);
      } catch (err) {
        emit({ type: "error", message: userErrorText(err, { where: "ネタ帳の更新" }) });
      } finally {
        updating().delete(key); // 終わった・失敗した・画面を閉じた、どれでも次の更新を受け付ける
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
// 見せる用：使った API 代を、要求した人に足す（1人あたりの上限。lib/personBudget.ts）
// 枠を取った直後にもう一度上限を見る（afterSlot。lib/shareGate.ts）
export const POST = perPerson(slotted(afterSlot(handlePost)));
