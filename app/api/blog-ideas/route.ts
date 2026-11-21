import { suggestBlogIdeas } from "@/lib/blog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  try {
    return Response.json(await suggestBlogIdeas());
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "不明なエラー" }, { status: 500 });
  }
}
