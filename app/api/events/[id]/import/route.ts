// POST /api/events/{id}/import：Googleフォームの回答を書き出した CSV を取り込む
//   { csv: string, save?: boolean（既定 true）, ask?: boolean（既定 true：決まらない列だけ Agent に聞く） }
// 個人情報の列は捨ててから保存する（data/survey_imports/{id}.json）。?mock の画面は save=false・ask=false で使う
import { randomUUID } from "node:crypto";
import { claudeColumnAsker, importSurveyCsv, saveImport } from "@/lib/surveyCsv";
import { slotted } from "@/lib/apiSlots";
import { perPerson } from "@/lib/personBudget";
import { afterSlot } from "@/lib/shareGate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handlePost(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { csv?: string; save?: boolean; ask?: boolean } | null;
  if (!body?.csv?.trim()) return Response.json({ error: "CSVが空です" }, { status: 400 });
  if (body.csv.length > 2_000_000) return Response.json({ error: "CSVが大きすぎます（2MBまで）" }, { status: 400 });
  let asker = null;
  if (body.ask !== false && process.env.ANTHROPIC_API_KEY) asker = claudeColumnAsker(randomUUID());
  const out = await importSurveyCsv(id, body.csv, { source: "upload", asker });
  if (!out.ok) return Response.json({ error: out.error }, { status: 400 });
  const save = body.save !== false;
  if (save) saveImport(out.data);
  const { answers, ...rest } = out.data;
  return Response.json({ ...rest, answers: answers.length, saved: save });
}

// API を使う操作は同時に2件まで（lib/apiSlots.ts）。超えたら 429
// 見せる用：使った API 代を、要求した人に足す（1人あたりの上限。lib/personBudget.ts）
// 枠を取った直後にもう一度上限を見る（afterSlot。lib/shareGate.ts）
export const POST = perPerson(slotted(afterSlot(handlePost)));
