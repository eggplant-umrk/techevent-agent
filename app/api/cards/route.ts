// GET: the notebook for the left pane. PATCH: 技術広報 edits a card (marks it 確認済み).
import { editCard, loadCards, type Card } from "@/lib/cards";
import { activities, employees, published } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const emps = new Map(employees().map((e) => [e.id, e]));
  const acts = new Map(activities().map((a) => [a.id, a]));
  const pubs = new Map(published().map((p) => [p.id, p]));
  const cards = loadCards()
    .slice()
    .sort((a, b) => Number(b.reviewed) - Number(a.reviewed) || (b.latest_activity_date > a.latest_activity_date ? 1 : -1))
    .map((c) => {
      const e = emps.get(c.employee_id);
      return {
        ...c,
        employee: e
          ? { id: e.id, name: e.name, business_unit: e.business_unit, role: e.role, past_talk_count: e.past_talk_count, last_talk_date: e.last_talk_date, workload: e.workload }
          : null,
        evidence: c.evidence_activity_ids.map((id) => {
          const a = acts.get(id);
          return a ? { id, type: a.type, date: a.date, title: a.title, body: a.body, where: a.channel ?? a.repo } : { id, type: "", date: "", title: id, body: "", where: null };
        }),
        announcements: c.announcement_activity_ids.map((id) => {
          const a = acts.get(id);
          return { id, date: a?.date ?? "", title: a?.title ?? id };
        }),
        published: c.published_ids.map((id) => {
          const p = pubs.get(id);
          return { id, date: p?.published_at.slice(0, 10) ?? "", genre: p?.genre ?? "", title: p?.title ?? id, url: p?.url ?? "" };
        }),
      };
    });
  const units = [...new Set(employees().map((e) => e.business_unit))];
  return Response.json({ cards, units });
}

export async function PATCH(req: Request) {
  const body = (await req.json()) as {
    card_id: string;
    patch: Partial<Pick<Card, "summary" | "themes" | "format" | "format_reason">>;
  };
  const out = editCard(body.card_id, body.patch);
  if (!out.ok) return Response.json({ error: out.errors.join(" / ") }, { status: 400 });
  return Response.json({ ok: true, card: out.card });
}
