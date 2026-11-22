import { suggestBlogIdeas } from "@/lib/blog";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";
import { perPerson } from "@/lib/personBudget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handlePost() {
  try {
    return Response.json(await suggestBlogIdeas());
  } catch (err) {
    return Response.json({ error: userErrorText(err, { where: "ブログのネタ" }) }, { status: 500 });
  }
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
// 見せる用：使った API 代を、要求した人に足す（1人あたりの上限。lib/personBudget.ts）
export const POST = perPerson(slotted(handlePost));
