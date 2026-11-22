// "ネタ帳を更新": streams the work log as NDJSON. Only employees with new activities are read.
import { updateNotebook, type NotebookEvent } from "@/lib/notebook";
import { slotted } from "@/lib/apiSlots";
import { LAN_BLOCKED, shareMode } from "@/lib/share";
import { userErrorText } from "@/lib/userError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// 更新は同時に1つだけ（2つ同時に動くと、同じ人の活動を2回読んで API 代が二重にかかり、カードも重なる）。
// 同じサーバーの中で数える（開発サーバーの読み直しでも消えないように globalThis に置く）
const g = globalThis as typeof globalThis & { __notebookUpdating?: boolean };
const NOTEBOOK_BUSY = "ネタ帳を更新中です。終わってから、もう一度押してください";

async function handlePost() {
  // 見せる用（SHARE_MODE=lan）では止める（入口の proxy.ts でも止めている）
  const blocked = shareMode() === "lan" ? LAN_BLOCKED.find((b) => b.path.test("/api/notebook")) : undefined;
  if (blocked) return Response.json({ error: blocked.reason }, { status: 403 });
  if (g.__notebookUpdating) return Response.json({ error: NOTEBOOK_BUSY }, { status: 409 });
  g.__notebookUpdating = true;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: NotebookEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await updateNotebook("pending", emit);
      } catch (err) {
        emit({ type: "error", message: userErrorText(err, { where: "ネタ帳の更新" }) });
      } finally {
        g.__notebookUpdating = false; // 終わった・失敗した・画面を閉じた、どれでも次の更新を受け付ける
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
export const POST = slotted(handlePost);
