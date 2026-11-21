// "ネタ帳を更新": streams the work log as NDJSON. Only employees with new activities are read.
import { updateNotebook, type NotebookEvent } from "@/lib/notebook";
import { slotted } from "@/lib/apiSlots";
import { LAN_BLOCKED, shareMode } from "@/lib/share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

async function handlePost() {
  // 見せる用（SHARE_MODE=lan）では止める（入口の proxy.ts でも止めている）
  const blocked = shareMode() === "lan" ? LAN_BLOCKED.find((b) => b.path.test("/api/notebook")) : undefined;
  if (blocked) return Response.json({ error: blocked.reason }, { status: 403 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: NotebookEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await updateNotebook("pending", emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "不明なエラー" });
      } finally {
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
