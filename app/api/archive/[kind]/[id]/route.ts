// アーカイブタブ：1件の詳細（日付・登壇者・依頼の結果）
import { archiveDetail, type ArchiveKind } from "@/lib/archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: ArchiveKind[] = ["inbox", "request", "event"];

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!KINDS.includes(kind as ArchiveKind)) return Response.json({ error: "種類が正しくありません" }, { status: 400 });
  const d = archiveDetail(kind as ArchiveKind, id);
  if (!d) return Response.json({ error: "アーカイブに見つかりません" }, { status: 404 });
  return Response.json(d);
}
