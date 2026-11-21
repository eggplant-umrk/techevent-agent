// 「ネタ帳を更新」の金額の見積もりを、記録済みの実際の値と比べる（APIは使わない・data/ に書き込まない）。
//   npx tsx scripts/check_notebook_estimate.ts          3つのデータをまとめて
//   npx tsx scripts/check_notebook_estimate.ts stress   1つだけ（stress / github / blog）
// 記録した回（data/usage.json の notebook）の「渡した活動」と「依頼文」をデータから作り直し、見積もりの式に入れて実際と比べる。
//   - 汚れたデータ（stress）3人：カードが空の状態から（docs/stress_report.md の6）
//   - 本物の GitHub（本人 e031）：カードが空の状態から53件（docs/notebook_demo_result.json）
//   - ブログ（架空の30人のうち書き手6人）：ブログの記事だけが新しい活動。カードはその回の前の状態（今のカードからブログの根拠を外したもの）
import { execFileSync } from "node:child_process";
import type { Card } from "../lib/cards";

/** 記録済みの実際の値（data/usage.json の notebook、1回の呼び出しごと。2026-11-21） */
export const RECORDED = {
  stress: [
    { eid: "e013", input: 2606, output: 1244, usd: 0.0499 },
    { eid: "e015", input: 1660, output: 993, usd: 0.0271 },
    { eid: "e024", input: 2191, output: 1212, usd: 0.0336 },
  ],
  github: [{ eid: "e031", input: 17057, output: 3851, usd: 0.1681 }],
  /** 6人を1回ずつ（呼び出しごとの内訳は記録が合算のため、合計だけ） */
  blog: { input: 5495, output: 6510, usd: 0.18, calls: 6 },
};
/** 直す前の見積もり（その回に画面・作業ログに出た値） */
export const OLD_ESTIMATE = { stress: 0.149, github: 0.15, blog: 0.087 };

type Source = keyof typeof OLD_ESTIMATE;
export interface Row {
  label: string;
  messageChars: number;
  activityChars: number;
  items: number;
}

export async function rowsFor(source: Source): Promise<{ rows: Row[]; systemChars: number }> {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  if (source === "stress") process.env.DATA_SOURCE = "stress";
  if (source === "github") process.env.DEMO_PERSON = "on";
  const { activities } = await import("../lib/data");
  const { loadCards } = await import("../lib/cards");
  const { filterActivities, capActivities, prepConfig } = await import("../lib/notebookPrep");
  const { employeeMessage, notebookSystemChars } = await import("../lib/notebook");
  const acts = activities();
  const chars = (xs: Array<{ title: string; body: string }>) => xs.reduce((n, a) => n + a.title.length + a.body.length, 0);
  const rows: Row[] = [];
  if (source === "blog") {
    const blogs = acts.filter((a) => a.type === "blog");
    const authors = [...new Set(blogs.map((b) => b.author_id))];
    const blogIds = new Set(blogs.map((b) => b.id));
    const before: Card[] = loadCards()
      .map((c) => ({ ...c, evidence_activity_ids: c.evidence_activity_ids.filter((id) => !blogIds.has(id)) }))
      .filter((c) => c.evidence_activity_ids.length > 0);
    for (const eid of authors) {
      const { kept } = filterActivities(blogs.filter((b) => b.author_id === eid));
      const { send } = capActivities(kept, prepConfig());
      const prep = { total: send.length, alreadyRead: 0, fresh: send.length, send, dropped: [], deferred: [], processed: new Set<string>() };
      rows.push({ label: eid, messageChars: employeeMessage(eid, prep, before).text.length, activityChars: chars(send), items: send.length });
    }
  } else {
    for (const r of RECORDED[source]) {
      // 読んだ記録（notebook_progress.json）は見ずに、その回と同じく全件を新しい活動として作り直す
      const { kept } = filterActivities(acts.filter((a) => a.author_id === r.eid));
      const { send } = capActivities(kept, prepConfig());
      const prep = { total: send.length, alreadyRead: 0, fresh: send.length, send, dropped: [], deferred: [], processed: new Set<string>() };
      rows.push({ label: r.eid, messageChars: employeeMessage(r.eid, prep, []).text.length, activityChars: chars(prep.send), items: prep.send.length });
    }
  }
  return { rows, systemChars: notebookSystemChars() };
}

async function one(source: Source) {
  const { estimateUsd } = await import("../lib/notebookPrep");
  const { rows, systemChars } = await rowsFor(source);
  const est = rows.reduce((n, r, i) => n + estimateUsd("claude-opus-5-5", r.messageChars, r.activityChars, systemChars, i === 0), 0);
  const actual = source === "blog" ? RECORDED.blog.usd : RECORDED[source].reduce((n, r) => n + r.usd, 0);
  const pct = (x: number) => `${x >= actual ? "+" : ""}${Math.round(((x - actual) / actual) * 100)}%`;
  console.log(JSON.stringify({ source, calls: rows.length, actual, old: OLD_ESTIMATE[source], new: Number(est.toFixed(4)), old_diff: pct(OLD_ESTIMATE[source]), new_diff: pct(est), system_chars: systemChars, rows }));
}

const arg = process.argv[2] as Source | undefined;
if (arg) {
  one(arg).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  // データの切り替えはプロセスごとに分ける（読み込んだデータのキャッシュを混ぜないため）
  for (const s of Object.keys(OLD_ESTIMATE) as Source[]) {
    const out = JSON.parse(execFileSync(process.execPath, [...process.execArgv, process.argv[1], s], { encoding: "utf-8" }).trim().split("\n").at(-1)!);
    console.log(`${s}：${out.calls}回 実際 $${out.actual.toFixed(3)}／直す前の見積もり $${out.old.toFixed(3)}（${out.old_diff}）→ 直した見積もり $${out.new.toFixed(3)}（${out.new_diff}）`);
    for (const r of out.rows as Row[]) console.log(`  ${r.label} 依頼文${r.messageChars}字・活動${r.items}件${r.activityChars}字`);
  }
}
