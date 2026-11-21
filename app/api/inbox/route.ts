// 受信箱の窓口（Slackボットと画面の「手で追加」が使う）。形は docs/inbox-api.md のとおりで、変えない。
//   POST /api/inbox  { text, source: "slack" | "manual", meta?: { channel, ts, user, permalink } } → { id }
//   GET  /api/inbox  画面用の一覧（新しい順）
// localhost からのリクエストだけ受け付ける。
import { runAgent } from "@/lib/agent";
import { addToInbox, listInbox, listView, parseInboxInput } from "@/lib/inbox";
import { forbidden, isLocalRequest } from "@/lib/localOnly";
import { extractNomineeWithAgent } from "@/lib/nominee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return forbidden();
  const body = await req.json().catch(() => null);
  const parsed = parseInboxInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  // 登録してすぐ返す。指名の読み取りと候補づくり（既存の runAgent）は裏で続く
  const item = addToInbox(parsed.input, (request, emit) => runAgent(request, emit), extractNomineeWithAgent);
  return Response.json({ id: item.id });
}

export function GET(req: Request) {
  if (!isLocalRequest(req)) return forbidden();
  return Response.json({ items: listInbox().map(listView) });
}
