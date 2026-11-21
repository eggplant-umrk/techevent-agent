// "ネタ帳を更新": streams the work log as NDJSON. Only employees with new activities are read.
import { updateNotebook, type NotebookEvent } from "@/lib/notebook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST() {
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
