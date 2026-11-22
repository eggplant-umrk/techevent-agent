// 使われた結果（data/runtime/feedback.jsonl）を、評価のケースの候補（lib/evalTypes.ts の形）に変えて data/runtime/eval_candidates/ に出す。
//   npm run eval:from-feedback
// - API は使わない。個人情報（メール・電話・住所の形、社員の実名以外の人名らしきもの）は落とす（lib/feedbackEval.ts）
// - リポジトリには入れない（data/runtime/ は git の対象外）。人が中身を確かめてから、評価のケースとして足す
// - 形は evalCaseProblems で確かめ、問題のあるものは出さずに理由を出す
import fs from "node:fs";
import path from "node:path";
import { boardDetail } from "../lib/board";
import { employees } from "../lib/data";
import { evalCaseProblems } from "../lib/evalTypes";
import { readFeedback, type Feedback } from "../lib/feedback";
import { employeeNameSet, feedbackToCase, type FeedbackSource } from "../lib/feedbackEval";
import { writeJsonAtomic } from "../lib/fileStore";
import { getInboxItem } from "../lib/inbox";
import { runtimeRoot } from "../lib/runtime";

const outDir = path.join(runtimeRoot(), "eval_candidates");
const rows = readFeedback();
const byRequest = new Map<string, Feedback[]>();
for (const r of rows) byRequest.set(r.request_id, [...(byRequest.get(r.request_id) ?? []), r]);
const keep = employeeNameSet(employees().map((e) => e.name));

function sourceOf(id: string): FeedbackSource {
  const it = getInboxItem(id);
  const d = boardDetail(id);
  const recorded = d ? { status: d.status ?? null, intake: (d as { intake?: unknown }).intake ?? null, result: d.result ?? null, usd: (d as { run_usd?: number }).run_usd ?? null } : null;
  return { text: it ? it.text : null, channel: it?.source, received_at: it?.received_at ?? null, recorded: recorded as FeedbackSource["recorded"] };
}

let written = 0;
const skipped: string[] = [];
for (const [id, list] of byRequest) {
  const { case: c, skipped: why } = feedbackToCase(id, list, sourceOf(id), keep);
  if (!c) {
    skipped.push(`${id}：${why}`);
    continue;
  }
  const problems = evalCaseProblems(c);
  if (problems.length) {
    skipped.push(`${id}：形の問題（${problems.join("／")}）`);
    continue;
  }
  writeJsonAtomic(path.join(outDir, `${c.id}.json`), c);
  written++;
}
console.log(`使われた結果 ${rows.length}件（依頼 ${byRequest.size}件）→ 評価のケースの候補 ${written}件を ${path.relative(process.cwd(), outDir) || outDir} に出しました`);
for (const s of skipped) console.log(`  出さなかった：${s}`);
if (written) console.log("リポジトリに入れるのは、人が中身（とくに個人情報が残っていないか）を確かめてからにしてください。自動ではコミットしません");
if (!fs.existsSync(outDir) && !written) console.log("（出すものはありませんでした）");
