import { runAgent, type AgentEvent } from "@/lib/agent";
import { resolveRequest } from "@/lib/requests";
import { saveSampleProposal } from "@/lib/board";
import { slotted } from "@/lib/apiSlots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handlePost(req: Request) {
  const body = (await req.json()) as { request_id?: string; custom_text?: string };
  const request = resolveRequest(body);
  if (!request) return Response.json({ error: "依頼が見つかりません" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const events: AgentEvent[] = [];
      let runUsd = 0;
      const emit = (e: AgentEvent) => {
        events.push(e);
        if (e.type === "done") runUsd = e.run_usd;
        controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      };
      try {
        const result = await runAgent(request, emit);
        // サンプルの依頼は、出した候補を保存して受信箱の状態を「候補準備済み」にする（受信箱の依頼は受信箱が保存する）
        if (result && !body.custom_text) saveSampleProposal(request.id, result, events, runUsd);
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

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
export const POST = slotted(handlePost);
