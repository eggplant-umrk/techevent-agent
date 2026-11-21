import { suggestBlogIdeas } from "@/lib/blog";
import { slotted } from "@/lib/apiSlots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handlePost() {
  try {
    return Response.json(await suggestBlogIdeas());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "不明なエラー" }, { status: 500 });
  }
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
export const POST = slotted(handlePost);
