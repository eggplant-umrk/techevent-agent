// GET: the notebook for the left pane. PATCH: 技術広報 edits a card (marks it 確認済み).
import { editCard, loadCards, type Card } from "@/lib/cards";
import { activities, employees, published } from "@/lib/data";
import { busynessFor, busyText, loadCalendarIfConfigured } from "@/lib/busyness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await loadCalendarIfConfigured(); // iCal を使う設定のときだけ
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
          ? { id: e.id, name: e.name, business_unit: e.business_unit, role: e.role, past_talk_count: e.past_talk_count, last_talk_date: e.last_talk_date, busy_text: busyText(busynessFor(e.id)) }
          : null,
        evidence: c.evidence_activity_ids.map((id) => {
          const a = acts.get(id);
          return a ? { id, type: a.type, date: a.date, title: a.title, body: a.body, where: a.channel ?? a.repo, url: a.url ?? null } : { id, type: "", date: "", title: id, body: "", where: null };
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
  const body = (await req.json().catch(() => null)) as {
    card_id: string;
    patch: Partial<Pick<Card, "summary" | "themes" | "format" | "format_reason">>;
  } | null;
  // JSON でない本文・形の違う本文は、500 ではなく 400 と理由
  if (!body || typeof body !== "object" || typeof body.card_id !== "string" || !body.patch || typeof body.patch !== "object" || Array.isArray(body.patch)) {
    return Response.json({ error: "送られた内容が読めません" }, { status: 400 });
  }
  const p = body.patch;
  if ((p.summary !== undefined && typeof p.summary !== "string") || (p.format_reason !== undefined && typeof p.format_reason !== "string") || (p.format !== undefined && typeof p.format !== "string") || (p.themes !== undefined && (!Array.isArray(p.themes) || p.themes.some((t) => typeof t !== "string")))) {
    return Response.json({ error: "送られた内容が読めません" }, { status: 400 });
  }
  const out = editCard(body.card_id, body.patch);
  if (!out.ok) return Response.json({ error: out.errors.join(" / ") }, { status: 400 });
  return Response.json({ ok: true, card: out.card });
}
