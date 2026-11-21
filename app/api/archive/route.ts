// アーカイブタブ：終わったイベントの一覧（開催日が過ぎた依頼と、過去のイベント）
import { archiveRows } from "@/lib/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ rows: archiveRows() });
}
