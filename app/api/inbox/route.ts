// 受信箱の窓口（Slackボットと画面の「手で追加」が使う）。形は docs/inbox-api.md のとおりで、変えない。
//   POST /api/inbox  { text, source: "slack" | "manual", meta?: { channel, ts, user, permalink } } → { id }（同じ文の依頼がすでにあれば { id, duplicate: true }）
//   GET  /api/inbox  画面用の一覧（新しい順）
// localhost からのリクエストだけ受け付ける。
import { runAgent } from "@/lib/agent";
import { addToInbox, continueInbox, getInboxItem, parseInboxInput } from "@/lib/inbox";
import { withApiSlotHandoff } from "@/lib/apiSlots";
import { boardList, findActiveContinuation, findActiveDuplicate } from "@/lib/board";
import { forbidden, isLocalRequest } from "@/lib/localOnly";
import { perPerson } from "@/lib/personBudget";
import { shareBudgetGate } from "@/lib/shareGate";
import { extractIntakeWithAgent } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handlePost(req: Request) {
  if (!isLocalRequest(req)) return forbidden();
  const body = await req.json().catch(() => null);
  const parsed = parseInboxInput(body);
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
  // 同じ文の依頼が受信箱にあれば（アーカイブを除く）、新しく足さずにその依頼を返す（画面はそれを開いて「同じ依頼がもうあります」）
  const dup = findActiveDuplicate(parsed.input.text);
  if (dup) return Response.json({ id: dup, duplicate: true });
  // 続きの会話（画面の「会話を貼って追加」だけ。Slack は今までどおり1投稿＝1件）：
  //   - 前の会話をまるごと含む → その依頼を更新する
  //   - 同じアカウントと同じイベント名 → 足さずに聞き返す（{ ask_continue }）。答えは continue_of（はい）か as_new（新しい依頼として追加）
  const b = (body ?? {}) as { continue_of?: unknown; as_new?: unknown };
  let continueId: string | null = null;
  if (parsed.input.source === "manual") {
    if (typeof b.continue_of === "string" && b.continue_of) {
      continueId = b.continue_of.slice(0, 120);
      if (!getInboxItem(continueId)) return Response.json({ error: "その依頼は受信箱にありません" }, { status: 404 });
    } else if (b.as_new !== true) {
      const cont = findActiveContinuation(parsed.input.text);
      if (cont?.kind === "contains") continueId = cont.id;
      else if (cont?.kind === "ask") return Response.json({ ask_continue: { id: cont.id, title: cont.title } });
    }
  }
  if (continueId && getInboxItem(continueId)?.status === "processing")
    return Response.json({ error: "その依頼は準備中です。終わってから、もう一度貼ってください" }, { status: 409 });
  // API を使う操作の同時実行の上限（lib/apiSlots.ts。空いていなければ最大60秒待つ）。候補づくりが裏で終わるまで1件分を持つ
  // 取ったあとに保存などが失敗したら（投げたら）、withApiSlotHandoff が枠を必ず返す
  return withApiSlotHandoff(req.signal, (release) => {
    // 枠を取った直後にもう一度上限を見る（待っている間にほかの人の操作で届いていたら、始めずに返す。lib/shareGate.ts）
    const gate = shareBudgetGate(req);
    if (!gate.ok) {
      release();
      return Response.json({ error: gate.error }, { status: gate.status });
    }
    // 待っている間に同じ文が先に入っていたら（連打）、枠を返してそちらを開く
    const dupAfterWait = findActiveDuplicate(parsed.input.text);
    if (dupAfterWait) {
      release();
      return Response.json({ id: dupAfterWait, duplicate: true });
    }
    if (continueId) {
      // 同じ依頼を更新する（読み取りをやり直し、変わっていれば候補づくりも。裏で続く）
      const out = continueInbox(continueId, parsed.input.text, (request, emit) => runAgent(request, emit), extractIntakeWithAgent, release);
      if (!out.ok) {
        release();
        return Response.json({ error: out.error }, { status: out.error === "準備中です" ? 409 : 400 });
      }
      return Response.json({ id: continueId, continued: true });
    }
    // 登録してすぐ返す。指名の読み取りと候補づくり（既存の runAgent）は裏で続く
    const item = addToInbox(parsed.input, (request, emit) => runAgent(request, emit), extractIntakeWithAgent, release);
    return Response.json({ id: item.id });
  });
}

// 見せる用：使った API 代（裏で続く候補づくりも）を、追加した人に足す（1人あたりの上限。lib/personBudget.ts）
export const POST = perPerson(handlePost);

export function GET(req: Request) {
  if (!isLocalRequest(req)) return forbidden();
  // 届いた依頼とサンプルの依頼を、依頼の状態つきで返す。開催日が過ぎた依頼は出さない（アーカイブへ。判定はコード）
  return Response.json({ items: boardList() });
}
