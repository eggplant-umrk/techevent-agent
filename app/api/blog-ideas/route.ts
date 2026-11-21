import { suggestBlogIdeas } from "@/lib/blog";
import { slotted } from "@/lib/apiSlots";
import { userErrorText } from "@/lib/userError";

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
export const POST = slotted(handlePost);
