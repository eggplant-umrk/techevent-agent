// 使われた結果の記録の窓口（画面のボタンは①が作る）。形は lib/feedback.ts。
//   POST /api/feedback { request_id, target, target_id, verdict, reason_code, note?, before?, after? } → { id }
//   data/runtime/feedback.jsonl に1行足す。API は使わない
import { appendFeedback, parseFeedback } from "@/lib/feedback";
import { getInboxItem } from "@/lib/inbox";
import { requests } from "@/lib/data";
import { currentRole, roleOf } from "@/lib/personBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = parseFeedback(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  // ある依頼（受信箱の依頼・サンプルの依頼）にだけ付ける
  const id = parsed.value.request_id;
  const exists = id.startsWith("inb-") ? !!getInboxItem(id) : requests().some((r) => r.id === id);
  if (!exists) return Response.json({ error: "その依頼が見つかりません" }, { status: 404 });
  // メンターの印：送られてきた本文の role は使わず、①の currentRole（窓口の中の人）か、要求の cookie（roleOf）で決める
  const mentor = (currentRole() ?? roleOf(req)) === "mentor";
  const fb = appendFeedback(mentor ? { ...parsed.value, role: "mentor" } : parsed.value);
  return Response.json({ id: fb.id });
}
