// 使われた結果（feedback.jsonl）を、評価のケースの候補（lib/evalTypes.ts の形）に変えて出す。
//   npm run eval:from-feedback                          … data/runtime/ の記録から → data/runtime/eval_candidates/
//   npm run eval:from-feedback -- data/sessions/<日時>   … save:session で写した記録から → <その場所>/eval_candidates/
//                                                          見せる用の記録（visitors/ がある）なら、人ごとに読んでまとめて出す
// - API は使わない。個人情報（メール・電話・住所の形、社員の実名以外の人名らしきもの）は落とす（lib/feedbackEval.ts）
// - リポジトリには入れない（data/runtime/・data/sessions/ は git の対象外）。人が中身を確かめてから、評価のケースとして足す
// - 形は evalCaseProblems で確かめ、問題のあるものは出さずに理由を出す
import fs from "node:fs";
import path from "node:path";
import { boardDetail } from "../lib/board";
import { employees } from "../lib/data";
import { evalCaseProblems } from "../lib/evalTypes";
import { feedbackFile, readFeedback, type Feedback } from "../lib/feedback";
import { employeeNameSet, feedbackToCase, type FeedbackSource } from "../lib/feedbackEval";
import { writeJsonAtomic } from "../lib/fileStore";
import { getInboxItem } from "../lib/inbox";
import { runtimeRoot } from "../lib/runtime";

const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
const keep = employeeNameSet(employees().map((e) => e.name));

/** 読む場所：使われた結果・受信箱・サンプルの依頼の結果。prefix は人ごとに読むときのケースの id の頭 */
interface Source {
  label: string;
  feedback: string;
  inbox?: string;
  samples?: string;
  prefix: string;
}

function sourcesOf(dir: string): Source[] {
  const at = (d: string, prefix: string, label: string): Source => ({
    label,
    feedback: path.join(d, "feedback.jsonl"),
    inbox: path.join(d, "inbox.json"),
    samples: path.join(d, "sample_proposals.json"),
    prefix,
  });
  const visitors = path.join(dir, "visitors");
  if (fs.existsSync(visitors)) {
    return fs
      .readdirSync(visitors)
      .filter((k) => fs.existsSync(path.join(visitors, k, "feedback.jsonl")))
      .map((k) => at(path.join(visitors, k), `${k.slice(0, 8)}-`, `見せる用の人 ${k.slice(0, 8)}`));
  }
  return [at(dir, "", dir)];
}

const sources: Source[] = arg ? sourcesOf(path.resolve(arg)) : [{ label: "data/runtime", feedback: feedbackFile(), prefix: "" }];
const outDir = arg ? path.join(path.resolve(arg), "eval_candidates") : path.join(runtimeRoot(), "eval_candidates");
if (arg && !fs.existsSync(path.resolve(arg))) {
  console.error(`その場所がありません：${arg}`);
  process.exit(1);
}

function recordOf(id: string): FeedbackSource {
  const it = getInboxItem(id);
  const d = boardDetail(id);
  const recorded = d ? { status: d.status ?? null, intake: (d as { intake?: unknown }).intake ?? null, result: d.result ?? null, usd: (d as { run_usd?: number }).run_usd ?? null } : null;
  return { text: it ? it.text : null, channel: it?.source, received_at: it?.received_at ?? null, recorded: recorded as FeedbackSource["recorded"] };
}

let total = 0;
let requests = 0;
let written = 0;
const skipped: string[] = [];
for (const s of sources) {
  // 受信箱・サンプルの依頼の結果は、その場所のファイルから読む
  if (s.inbox) process.env.INBOX_FILE = s.inbox;
  if (s.samples) process.env.SAMPLE_PROPOSALS_FILE = s.samples;
  const rows = readFeedback(s.feedback);
  total += rows.length;
  const byRequest = new Map<string, Feedback[]>();
  for (const r of rows) byRequest.set(r.request_id, [...(byRequest.get(r.request_id) ?? []), r]);
  requests += byRequest.size;
  for (const [id, list] of byRequest) {
    const { case: c, skipped: why } = feedbackToCase(id, list, recordOf(id), keep);
    if (!c) {
      skipped.push(`${s.prefix}${id}：${why}`);
      continue;
    }
    if (s.prefix) c.id = `usage-${s.prefix}${c.id.replace(/^usage-/, "")}`; // 人ごとに同じ依頼（サンプルの依頼など）があっても重ならない
    const problems = evalCaseProblems(c);
    if (problems.length) {
      skipped.push(`${s.prefix}${id}：形の問題（${problems.join("／")}）`);
      continue;
    }
    writeJsonAtomic(path.join(outDir, `${c.id}.json`), c);
    written++;
  }
}
console.log(
  `使われた結果 ${total}件（依頼 ${requests}件${sources.length > 1 ? `・${sources.length}人分` : ""}）→ 評価のケースの候補 ${written}件を ${path.relative(process.cwd(), outDir) || outDir} に出しました`,
);
for (const s of skipped) console.log(`  出さなかった：${s}`);
if (written) console.log("リポジトリに入れるのは、人が中身（とくに個人情報が残っていないか）を確かめてからにしてください。自動ではコミットしません");
if (!written) console.log("（出すものはありませんでした）");
