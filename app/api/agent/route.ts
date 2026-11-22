import { runAgent, type AgentEvent } from "@/lib/agent";
import { CUSTOM_TEXT_CLOSED, resolveRequest } from "@/lib/requests";
import { getInboxItem, READ_FAILED_ERROR, rereadIfFailed } from "@/lib/inbox";
import { extractIntakeWithAgent, KIND_LABEL } from "@/lib/intake";
import { saveSampleProposal } from "@/lib/board";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";
import { traceEmit, withTrace } from "@/lib/trace";
import { perPerson } from "@/lib/personBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handlePost(req: Request) {
  const body = (await req.json().catch(() => null)) as { request_id?: string; custom_text?: string } | null;
  // JSON でない本文・形の違う本文は、500 ではなく 400 と理由
  if (!body || typeof body !== "object" || (body.request_id !== undefined && typeof body.request_id !== "string") || (body.custom_text !== undefined && typeof body.custom_text !== "string")) {
    return Response.json({ error: "送られた内容が読めません" }, { status: 400 });
  }
  // 貼った文を直接送る道は閉じた（受信箱の関所を通らないため）。会話は受信箱に入れる
  if (body.custom_text) return Response.json({ error: CUSTOM_TEXT_CLOSED }, { status: 400 });
  // 読み取りに失敗した受信箱の1件は、候補づくりの前に読み直して関所を通す（依頼ではない・不適切なら止める）
  if (body.request_id?.startsWith("inb-")) await rereadIfFailed(body.request_id, extractIntakeWithAgent);
  const request = resolveRequest(body);
  if (!request) {
    const it = body.request_id?.startsWith("inb-") ? getInboxItem(body.request_id) : undefined;
    const why =
      it?.read_status === "failed"
        ? `${READ_FAILED_ERROR}。少し待ってからもう一度押してください`
        : it?.kind && it.kind !== "request"
          ? `「${KIND_LABEL[it.kind]}」と読んだので、候補は出しません`
          : "依頼が見つかりません";
    return Response.json({ error: why }, { status: 400 });
  }

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
export const POST = perPerson(slotted(handlePost));
