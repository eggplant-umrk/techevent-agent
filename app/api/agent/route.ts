import { runAgent, type AgentEvent } from "@/lib/agent";
import { resolveRequest } from "@/lib/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json()) as { request_id?: string; custom_text?: string };
  const request = resolveRequest(body);
  if (!request) return Response.json({ error: "依頼が見つかりません" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await runAgent(request, emit);
      } catch (err) {
        // Never echo request headers or config; only the error message.
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
