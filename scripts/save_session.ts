// 実行時の記録を写して残す（reset:demo で戻す前に）。API は使わない。
//   npm run save:session            … 発表用：data/runtime/ の記録を data/sessions/<日時>/ に写す
//   npm run save:session -- --share … 見せる用：data/runtime-share/ の visitors/（人ごとの場所）をまとめて写す
// 写すもの：使われた結果（feedback.jsonl）・実行の記録（traces/）・受信箱（inbox.json）・金額の記録（usage.json）。
//           サンプルの依頼の結果（sample_proposals.json）も、評価のケースに変えるときに使うので写す
// data/sessions/ は git の対象外（中身に貼られた会話などが入るため）。写したものからは
//   npm run eval:from-feedback -- data/sessions/<日時>
// で評価のケースの候補を作れる。
import fs from "node:fs";
import path from "node:path";
import { feedbackFile } from "../lib/feedback";
import { tracesDir } from "../lib/trace";
import { usageFilePath } from "../lib/usageFile";

const share = process.argv.includes("--share");
const root = process.cwd();
const SESSIONS = () => process.env.SESSIONS_DIR || path.join(root, "data", "sessions");

/** 日本時間の日時（フォルダ名）：20261122-101530 */
function stamp(): string {
  const j = new Date(Date.now() + 9 * 3600_000).toISOString();
  return `${j.slice(0, 10).replace(/-/g, "")}-${j.slice(11, 19).replace(/:/g, "")}`;
}

const copied: string[] = [];
const missing: string[] = [];
function copy(from: string, to: string, label: string) {
  if (!fs.existsSync(from)) {
    missing.push(label);
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true });
  copied.push(label);
}

let dest = path.join(SESSIONS(), stamp());
for (let i = 2; fs.existsSync(dest); i++) dest = path.join(SESSIONS(), `${stamp()}-${i}`);

if (share) {
  // 見せる用：serve.mjs と同じ置き場（SHARE_DATA_DIR、既定 data/runtime-share）
  const base = path.resolve((process.env.SHARE_DATA_DIR ?? "").trim() || path.join(root, "data", "runtime-share"));
  copy(path.join(base, "visitors"), path.join(dest, "visitors"), "visitors/（人ごとの場所）");
  copy(path.join(base, "usage.json"), path.join(dest, "usage.json"), "usage.json（全員の合計）");
  copy(path.join(base, "person_usage.json"), path.join(dest, "person_usage.json"), "person_usage.json（1人あたりの金額）");
} else {
  // 発表用：lib と同じ置き場所の決め方（DATA_RUNTIME_DIR・INBOX_FILE・USAGE_FILE があればそれ）
  copy(feedbackFile(), path.join(dest, "feedback.jsonl"), "feedback.jsonl（使われた結果）");
  copy(tracesDir(), path.join(dest, "traces"), "traces/（実行の記録）");
  copy(process.env.INBOX_FILE || path.join(root, "data", "inbox.json"), path.join(dest, "inbox.json"), "inbox.json（受信箱）");
  copy(usageFilePath(), path.join(dest, "usage.json"), "usage.json（金額の記録）");
  copy(process.env.SAMPLE_PROPOSALS_FILE || path.join(root, "data", "sample_proposals.json"), path.join(dest, "sample_proposals.json"), "sample_proposals.json（サンプルの依頼の結果）");
}

if (!copied.length) {
  console.log(`写すものがありませんでした（${share ? "見せる用" : "発表用"}の記録がまだありません）。何も作っていません`);
  process.exit(0);
}
console.log(`${share ? "見せる用" : "発表用"}の記録を ${path.relative(root, dest) || dest} に写しました：${copied.join("・")}`);
if (missing.length) console.log(`  なかったもの：${missing.join("・")}`);
console.log(`  評価のケースの候補にする：npm run eval:from-feedback -- ${path.relative(root, dest).replace(/\\/g, "/")}`);
console.log("  data/sessions/ は git の対象外です（貼られた会話などが入るため）。コミットしないでください");
