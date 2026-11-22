import { runAgent, type AgentEvent } from "@/lib/agent";
import { forClient } from "@/lib/clientView";
import { resolveRequest } from "@/lib/requests";
import { saveSampleProposal } from "@/lib/board";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";
import { traceEmit, withTrace } from "@/lib/trace";
import { perPerson } from "@/lib/personBudget";
import { afterSlot } from "@/lib/shareGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handlePost(req: Request) {
  const body = (await req.json().catch(() => null)) as { request_id?: string; custom_text?: string } | null;
  // JSON でない本文・形の違う本文は、500 ではなく 400 と理由
  if (!body || typeof body !== "object" || (body.request_id !== undefined && typeof body.request_id !== "string") || (body.custom_text !== undefined && typeof body.custom_text !== "string")) {
    return Response.json({ error: "送られた内容が読めません" }, { status: 400 });
  }
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
        controller.enqueue(encoder.encode(JSON.stringify(forClient(e)) + "\n"));
      };
      try {
        // 実行の記録（lib/trace.ts）：依頼の id で残す。その場で書いた依頼（custom_text）は残さない
        const result = body.custom_text ? await runAgent(request, emit) : await withTrace(request.id, () => runAgent(request, traceEmit(emit)));
        // サンプルの依頼は、出した候補を保存して受信箱の状態を「候補準備済み」にする（受信箱の依頼は受信箱が保存する）
        if (result && !body.custom_text) saveSampleProposal(request.id, result, events, runUsd);
      } catch (err) {
        // Never echo request headers or config; only the error message.
        emit({ type: "error", message: userErrorText(err, { where: "候補づくり", retryLabel: "もう一度探す" }) });
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
// 見せる用：使った API 代を、要求した人に足す（1人あたりの上限。lib/personBudget.ts）
// 枠を取った直後にもう一度上限を見る（afterSlot。lib/shareGate.ts）
export const POST = perPerson(slotted(afterSlot(handlePost)));
