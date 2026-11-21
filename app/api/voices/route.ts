// ネタ帳タブの「アンケートの声」：参加者が今後聞いてみたい話（イベント名・日付・件数・合う人）
import { loadCards } from "@/lib/cards";
import { employeeById, events } from "@/lib/data";
import { loadAnalyses } from "@/lib/surveys";
import { surveyVoices } from "@/lib/surveyOverview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  // 登壇者本人のカードは、書き戻しと同じく活動の新しいカードを先にする
  const cards = loadCards()
    .slice()
    .sort((a, b) => (a.latest_activity_date < b.latest_activity_date ? 1 : -1))
    .map((c) => ({ card_id: c.card_id, employee_id: c.employee_id, name: employeeById(c.employee_id)?.name ?? c.employee_id, themes: [...c.themes, ...c.pending_themes] }));
  return Response.json({ voices: surveyVoices(Object.values(loadAnalyses()), events(), cards) });
}
