// 受信箱の窓口（Slackボットと画面の「手で追加」が使う）。形は docs/inbox-api.md のとおりで、変えない。
//   POST /api/inbox  { text, source: "slack" | "manual", meta?: { channel, ts, user, permalink } } → { id }（同じ文の依頼がすでにあれば { id, duplicate: true }）
//   GET  /api/inbox  画面用の一覧（新しい順）
// localhost からのリクエストだけ受け付ける。
import { runAgent } from "@/lib/agent";
import { addToInbox, parseInboxInput } from "@/lib/inbox";
import { acquireApiSlotWait, apiBusyResponse } from "@/lib/apiSlots";
import { boardList, findActiveDuplicate } from "@/lib/board";
import { forbidden, isLocalRequest } from "@/lib/localOnly";
import { extractIntakeWithAgent } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return forbidden();
  const body = await req.json().catch(() => null);
  const parsed = parseInboxInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  // 同じ文の依頼が受信箱にあれば（アーカイブを除く）、新しく足さずにその依頼を返す（画面はそれを開いて「同じ依頼がもうあります」）
  const dup = findActiveDuplicate(parsed.input.text);
  if (dup) return Response.json({ id: dup, duplicate: true });
  // API を使う操作は同時に2件まで（lib/apiSlots.ts。空いていなければ最大60秒待つ）。候補づくりが裏で終わるまで1件分を持つ
  const release = await acquireApiSlotWait(req.signal);
  if (!release) return apiBusyResponse();
  // 待っている間に同じ文が先に入っていたら（連打）、枠を返してそちらを開く
  const dupAfterWait = findActiveDuplicate(parsed.input.text);
  if (dupAfterWait) {
    release();
    return Response.json({ id: dupAfterWait, duplicate: true });
  }
  // 登録してすぐ返す。指名の読み取りと候補づくり（既存の runAgent）は裏で続く
  const item = addToInbox(parsed.input, (request, emit) => runAgent(request, emit), extractIntakeWithAgent, release);
  return Response.json({ id: item.id });
}

export function GET(req: Request) {
  if (!isLocalRequest(req)) return forbidden();
  // 届いた依頼とサンプルの依頼を、依頼の状態つきで返す。開催日が過ぎた依頼は出さない（アーカイブへ。判定はコード）
  return Response.json({ items: boardList() });
}
