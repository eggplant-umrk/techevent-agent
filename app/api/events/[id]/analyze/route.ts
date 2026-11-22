// POST /api/events/{id}/analyze：アンケートを分析してカードに書き戻す。作業ログを NDJSON で流す
import { analyzeEvent, type SurveyEvent } from "@/lib/surveys";
import { forClient } from "@/lib/clientView";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";
import { perPerson } from "@/lib/personBudget";
import { afterSlot } from "@/lib/shareGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handlePost(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: SurveyEvent) => controller.enqueue(encoder.encode(JSON.stringify(forClient(e)) + "\n"));
      try {
        await analyzeEvent(id, emit);
      } catch (err) {
        emit({ type: "error", message: userErrorText(err, { where: "アンケートの分析" }) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
// 見せる用：使った API 代を、要求した人に足す（1人あたりの上限。lib/personBudget.ts）
// 枠を取った直後にもう一度上限を見る（afterSlot。lib/shareGate.ts）
export const POST = perPerson(slotted(afterSlot(handlePost)));
