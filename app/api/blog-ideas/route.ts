import { suggestBlogIdeas } from "@/lib/blog";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";
import { perPerson } from "@/lib/personBudget";
import { afterSlot } from "@/lib/shareGate";
import { forClient } from "@/lib/clientView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handlePost() {
  try {
    return Response.json(forClient(await suggestBlogIdeas())); // 見せる用では合計（total_usd）を返さない
  } catch (err) {
    return Response.json({ error: userErrorText(err, { where: "ブログのネタ" }) }, { status: 500 });
  }
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
// 見せる用：使った API 代を、要求した人に足す（1人あたりの上限。lib/personBudget.ts）
// 枠を取った直後にもう一度上限を見る（afterSlot。lib/shareGate.ts）
export const POST = perPerson(slotted(afterSlot(handlePost)));
