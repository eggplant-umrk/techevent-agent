// ネタ帳タブの「アンケートの声」：参加者が今後聞いてみたい話（イベント名・日付・件数・合う人）
import { loadCards } from "@/lib/cards";
import { employeeById, events } from "@/lib/data";
import { loadAnalyses } from "@/lib/surveys";
import { surveyVoices } from "@/lib/surveyOverview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const cards = loadCards().map((c) => ({ card_id: c.card_id, employee_id: c.employee_id, name: employeeById(c.employee_id)?.name ?? c.employee_id }));
  return Response.json({ voices: surveyVoices(Object.values(loadAnalyses()), events(), cards) });
}
