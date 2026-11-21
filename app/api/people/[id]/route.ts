// ネタ帳タブ：人の詳細（GET）と、人の情報を直す（PATCH。直した項目は確認済みになり、Agent は上書きしない）
import { editPerson, personDetail, type PersonPatch } from "@/lib/people";

import { loadCalendarIfConfigured } from "@/lib/busyness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await loadCalendarIfConfigured(); // iCal を使う設定のときだけ（本人の予定）
  const d = personDetail(id);
  if (!d) return Response.json({ error: "その人は見つかりません" }, { status: 404 });
  return Response.json(d);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as PersonPatch | null;
  if (!body || typeof body !== "object") return Response.json({ error: "直す内容がありません" }, { status: 400 });
  const r = editPerson(id, body);
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ ok: true, person: r.person });
}
