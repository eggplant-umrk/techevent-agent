// POST /api/events/{id}/analyze：アンケートを分析してカードに書き戻す。作業ログを NDJSON で流す
import { analyzeEvent, type SurveyEvent } from "@/lib/surveys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: SurveyEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        await analyzeEvent(id, emit);
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "不明なエラー" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
