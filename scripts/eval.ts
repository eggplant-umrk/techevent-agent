// Evaluation in two stages. Only this script reads data/README.md (the answer key);
// the agent never sees it.
//
//   npm run eval -- req004                  # one request, integration checks only
//   npm run eval -- all                     # stage 1 (integration) + stage 2 (LLM quality vs before)
//   npm run eval -- all --report docs/eval_after.md
//
// Stage 1 — integration test, judged by code. Fails (exit 1) below 90%.
//   per request: evidence ids exist / nothing is sent / an expected candidate is in the top 3
//   named requests: an alternative is proposed and it is an expected person
//   notebook: >= 15 of the 20 untold activities are in unpublished cards
//   write-back: after recording a decline on a card, the same request's proposal changes
// Stage 2 — quality of theme ideas, scored by an LLM judge for before (v0.1) and after.
//
// Uses API credits (except --offline). The key is read from .env into this process only, and only for real runs.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cautionDateProblems, runAgent, userFacingTextProblems, type AgentEvent, type ProposalResult } from "../lib/agent";
import { getClient } from "../lib/anthropic";
import { appendOutreach, loadCards, removeOutreach } from "../lib/cards";
import { activities, employees, requests, type SpeakingRequest } from "../lib/data";
import { chooseModels, recordUsage, runUsd, totalUsd } from "../lib/usage";
import { SURVEY_REQUEST, surveyCodeChecks, surveyLiveCheck } from "./eval_survey";
import { getInboxItem, prepare, registerInbox, type InboxItem } from "../lib/inbox";
import { extractIntakeWithAgent } from "../lib/intake";
import { externalEventById, isClosed, themesOf } from "../lib/externalEvents";
import { internalTermProblems } from "../lib/plainText";
import { findVenues, type VenueEvent, type VenueResult } from "../lib/venues";

// API キー（.env）を読むのは本番実行のときだけ。--offline は API を使わないので .env がなくても動く
if (!process.argv.includes("--offline")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    console.error(".env がありません。APIを使う評価には .env の ANTHROPIC_API_KEY が必要です（APIなしで判定し直すなら --offline）。");
    process.exit(1);
  }
}

// 評価は常に架空データで行う（.env に DATA_SOURCE があっても切り替えない）
delete process.env.DATA_SOURCE;
delete process.env.DEMO_PERSON; // デモ用の31人目（本人）も入れない
process.env.RELEASE_NOTES = "off"; // リリースノートも入れない（今までどおりの材料で判定する）

const PASS_RATE = 0.9;

/** 候補の人数（0〜5人、0人なら見つからない理由）・並び（自信のある候補が先）・登壇経験の印 */
function countCheck(label: string, result: ProposalResult | null): Check {
  if (!result) return { name: `${label} 候補は5人まで・自信のある候補が先・印あり`, pass: false, detail: "結果なし" };
  const c = result.candidates;
  const problems: string[] = [];
  if (c.length > 5) problems.push(`${c.length}人`);
  if (c.length === 0 && !result.no_fit?.reasons.length) problems.push("0人なのに見つからない理由がない");
  const firstCond = c.findIndex((x) => x.confidence === "conditional");
  if (firstCond >= 0 && c.slice(firstCond).some((x) => x.confidence === "strong")) problems.push("条件付きの後に自信のある候補");
  const noTag = c.filter((x) => !["初登壇", "半年以内に登壇", "登壇経験あり"].includes(String(x.talk_tag))).map((x) => x.employee_id);
  if (noTag.length) problems.push(`印なし: ${noTag.join(",")}`);
  return {
    name: `${label} 候補は5人まで・自信のある候補が先・印あり`,
    pass: problems.length === 0,
    detail: problems.join(" / ") || `${c.length}人（自信あり${c.filter((x) => x.confidence === "strong").length}・条件付き${c.filter((x) => x.confidence === "conditional").length}）`,
  };
}
const WRITEBACK_REQUEST = "req003";

/**
 * カード → 出し先。どちらもテーマの合う締切済みのイベントがデータにある（出さないことを確かめる）。
 * expect：上位の出し先のテーマ・名前に、このどれかが入っていれば「テーマが合う」
 */
const VENUE_CASES = [
  { card_id: "card-e024-01", label: "脆弱性の自動トリアージ（セキュリティ）", expect: ["セキュリティ", "脆弱性"] },
  { card_id: "card-e016-01", label: "オンコール負荷の削減（SRE）", expect: ["SRE", "信頼性", "運用", "インシデント", "モニタリング", "オブザーバビリティ"] },
];

/** 受信箱経由の指名あり依頼。req004 と同じ内容を、構造化された項目なしの本文だけで送る */
const INBOX_CASE = {
  based_on: "req004",
  nominee: "e002",
  text:
    "【登壇のご相談】Web Performance Night 2027 Winter（2027-01-28 開催、渋谷、セッション20分、聴衆はフロントエンドエンジニア約100名）\n" +
    "layerx.go のアーカイブで笹倉さんのお話を拝見しました。大規模SaaSの初期表示改善について、ぜひ笹倉さんにご登壇いただきたいです。12/5までにお返事いただけると助かります。",
};

// ---------------------------------------------------------------------------
// Answer key (README only)
// ---------------------------------------------------------------------------
const README = fs.readFileSync(path.join(process.cwd(), "data", "README.md"), "utf-8");

function sectionOf(title: string): string {
  return README.split(title)[1]?.split(/\n#{2,3} |\n---/)[0] ?? "";
}

/** Expected candidates per request. Excludes the nominee and the five most frequent speakers. */
function loadExpected(): Record<string, { ids: string[]; primary?: string }> {
  const top5 = new Set(
    employees()
      .slice()
      .sort((a, b) => b.past_talk_count - a.past_talk_count)
      .slice(0, 5)
      .map((e) => e.id),
  );
  const reqs = new Map(requests().map((r) => [r.id, r]));
  const out: Record<string, { ids: string[]; primary?: string }> = {};
  for (const line of sectionOf("### 依頼ごとの想定候補").split("\n")) {
    const m = line.match(/^\|\s*(req\d{3})[^|]*\|(.*)\|\s*$/);
    if (!m) continue;
    const nominee = reqs.get(m[1])?.nominated_employee_id;
    const ids = [...new Set(m[2].match(/e\d{3}/g) ?? [])].filter((id) => id !== nominee && !top5.has(id));
    out[m[1]] = { ids, primary: ids[0] };
  }
  return out;
}

/** The 20 untold activity ids. */
function loadUntold(): string[] {
  return [...new Set(sectionOf("### 未発信の取り組み").match(/act\d{3}/g) ?? [])];
}

// ---------------------------------------------------------------------------
// 「送信なし」：コードを静的に調べる（app/・lib/・components/・scripts/）
// ルール：送ってよいのは、依頼スレッドへの受付の返信と、SLACK_NOTIFY_CHANNEL（技術広報だけの非公開チャンネル）への通知だけ。
//         候補の名前・理由・件数・見つからない理由は Slack のどこにも書かない。DM・別チャンネル・候補者本人への送信は作らない。
// - Slack への投稿（chat.postMessage）は scripts/slack-bot.ts の2か所だけ許す
//     replyInThread：チャンネルは SLACK_REQUEST_CHANNEL 固定・thread_ts 必須・文は決まった文（THREAD_TEXT）
//     notifyPrivate：チャンネルは SLACK_NOTIFY_CHANNEL 固定・設定がなければ送らない・文は決まった文とリンク（notifyText）
// - 決まった文（scripts/slack/core.ts の THREAD_TEXT・NOTIFY_TEXT）に値を埋め込まない。ボットは候補の情報を読まない
// - それ以外の投稿・DM・メールなどの送信の処理があれば不合格
// ---------------------------------------------------------------------------
const FORBIDDEN_SEND = [
  /slack\.com\/api/i,
  /hooks\.slack\.com/i,
  /response_url/,
  /chat\.(postEphemeral|scheduleMessage|meMessage)/,
  /conversations\.open|im\.open|mpim\.open/, // DM を開く
  /files\.upload/,
  /\bsay\s*\(/, // Bolt の say はスレッド外に投稿できる
  /\brespond\s*\(/,
  /new\s+WebClient\b/,
  /nodemailer/i,
  /sendMail\s*\(/,
  /smtp/i,
  /sendgrid/i,
  /twilio/i,
];
const POST_MESSAGE = /chat\.postMessage/g;
const ALLOWED_POST_FILE = path.join("scripts", "slack-bot.ts");
const SLACK_CORE_FILE = path.join("scripts", "slack", "core.ts");
const SCAN_SELF = path.join("scripts", "eval.ts"); // この判定自身（パターンを書いているので除く）
/** ボットが読んではいけない、候補の情報の項目名 */
const CANDIDATE_FIELDS = /\b(candidates|reason_short|no_fit|summary|next_checks|cautions|caveat)\b/;

/** 関数の本体（2スペースの字下げで閉じるところまで） */
const bodyOf = (src: string, sig: RegExp) => src.match(new RegExp(sig.source + String.raw`\s*\{([\s\S]*?)\n  \}`))?.[1] ?? null;

/** 許可した2か所が「決まったチャンネル・決まった文」の投稿になっているか。問題を文で返す。 */
export function checkAllowedPost(src: string, core: string): string[] {
  const problems: string[] = [];
  if (!/const\s+requestChannel\s*=\s*required\(\s*"SLACK_REQUEST_CHANNEL"/.test(src)) problems.push("返信のチャンネルが SLACK_REQUEST_CHANNEL に固定されていない");
  if (!/const\s+notifyChannel\s*=\s*process\.env\.SLACK_NOTIFY_CHANNEL\b/.test(src)) problems.push("通知のチャンネルが SLACK_NOTIFY_CHANNEL に固定されていない");

  const reply = bodyOf(src, /async function replyInThread\(threadTs: string, kind: ThreadKind\)/);
  if (reply === null) problems.push("返信が replyInThread(threadTs, kind) の中にない");
  else {
    if (!/if \(!threadTs\) throw/.test(reply)) problems.push("thread_ts がないときに止めていない");
    const call = reply.match(/chat\.postMessage\(\{([^}]*)\}\)/)?.[1];
    if (!call) problems.push("replyInThread の中に投稿がない");
    else {
      if (!/\bchannel:\s*requestChannel\b/.test(call)) problems.push("返信のチャンネルが requestChannel ではない");
      if (!/\bthread_ts:\s*threadTs\b/.test(call)) problems.push("返信に thread_ts: threadTs がない");
      if (!/\btext:\s*THREAD_TEXT\[kind\]/.test(call)) problems.push("返信の文が決まった文（THREAD_TEXT）ではない");
    }
  }

  const notify = bodyOf(src, /async function notifyPrivate\(kind: NotifyKind, link: string \| null\)/);
  if (notify === null) problems.push("通知が notifyPrivate(kind, link) の中にない");
  else {
    if (!/if \(!notifyChannel\) return/.test(notify)) problems.push("SLACK_NOTIFY_CHANNEL がないときに送らない作りになっていない");
    const call = notify.match(/chat\.postMessage\(\{([^}]*)\}\)/)?.[1];
    if (!call) problems.push("notifyPrivate の中に投稿がない");
    else {
      if (!/\bchannel:\s*notifyChannel\b/.test(call)) problems.push("通知のチャンネルが notifyChannel ではない");
      if (/\bthread_ts\b/.test(call)) problems.push("通知に thread_ts がある（依頼スレッドに書いてしまう）");
      if (!/\btext:\s*notifyText\(kind, link\)/.test(call)) problems.push("通知の文が決まった文（notifyText）ではない");
    }
  }

  // 決まった文：値を埋め込まない。notifyText は決まった文とリンクだけ
  for (const name of ["THREAD_TEXT", "NOTIFY_TEXT"]) {
    const obj = core.match(new RegExp(String.raw`export const ${name} = \{([\s\S]*?)\} as const;`))?.[1];
    if (!obj) problems.push(`${name} が決まった文の一覧（as const）になっていない`);
    else if (/\$\{|`/.test(obj)) problems.push(`${name} に値を埋め込んでいる`);
  }
  const nt = core.match(/export function notifyText\(kind: NotifyKind, link: string \| null\): string \{([\s\S]*?)\n\}/)?.[1];
  if (!nt) problems.push("notifyText(kind, link) がない");
  else if (/\$\{(?!NOTIFY_TEXT\[kind\]\}|link\}|label\})/.test(nt)) problems.push("notifyText が決まった文とリンク以外を埋め込んでいる");

  // ボットは候補の情報を読まない
  for (const [where, text] of [["scripts/slack-bot.ts", src], ["scripts/slack/core.ts", core]] as const)
    if (CANDIDATE_FIELDS.test(text)) problems.push(`${where} が候補の情報（${text.match(CANDIDATE_FIELDS)![0]}）を読んでいる`);
  return problems;
}

function scanForSend(): { hits: string[]; allowed: string[] } {
  const hits: string[] = [];
  const allowed: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) {
        if (f.name !== "node_modules") walk(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(f.name)) continue;
      const rel = path.relative(process.cwd(), p);
      if (rel === SCAN_SELF) continue;
      const src = fs.readFileSync(p, "utf-8");
      for (const re of FORBIDDEN_SEND) if (re.test(src)) hits.push(`${rel}: ${re}`);
      const posts = src.match(POST_MESSAGE)?.length ?? 0;
      if (posts === 0) continue;
      if (rel !== ALLOWED_POST_FILE) hits.push(`${rel}: 許可していない Slack への投稿 ${posts}か所`);
      else if (posts !== 2) hits.push(`${rel}: Slack への投稿が${posts}か所（許すのは受付の返信と非公開チャンネルへの通知の2か所だけ）`);
      else {
        const core = fs.existsSync(path.join(process.cwd(), SLACK_CORE_FILE)) ? fs.readFileSync(path.join(process.cwd(), SLACK_CORE_FILE), "utf-8") : "";
        const problems = checkAllowedPost(src, core);
        if (problems.length) hits.push(`${rel}: ${problems.join("・")}`);
        else allowed.push(`${rel} の受付の返信と非公開チャンネルへの通知（決まった文だけ）`);
      }
    }
  };
  for (const dir of ["app", "lib", "components", "scripts"]) {
    if (fs.existsSync(path.join(process.cwd(), dir))) walk(path.join(process.cwd(), dir));
  }
  // 窓口（GET /api/inbox/{id}）は候補の名前・理由を返さない
  const inboxSrc = fs.readFileSync(path.join(process.cwd(), "lib", "inbox.ts"), "utf-8");
  const pv = inboxSrc.match(/export function publicView\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  if (!pv) hits.push("lib/inbox.ts: publicView がない");
  else if (/summary|candidates|result/.test(pv)) hits.push("lib/inbox.ts: 窓口が候補の情報を返している");
  const routes = fs.readdirSync(path.join(process.cwd(), "app", "api"));
  for (const r of routes) if (/send|post|mail|notify|slack/i.test(r)) hits.push(`app/api/${r}: send-like route`);
  return { hits, allowed };
}

// ---------------------------------------------------------------------------
// Running the agent
// ---------------------------------------------------------------------------
function progress(e: AgentEvent): string | null {
  switch (e.type) {
    case "step":
      return `  step ${e.n}`;
    case "tool_call":
      return `    → ${e.name} ${JSON.stringify(e.input).slice(0, 90)}`;
    case "retry":
      return `    ! 差し戻し: ${e.message}`;
    case "error":
      return `    ✗ ${e.message}`;
    default:
      return null;
  }
}

async function propose(r: SpeakingRequest, withPitch = true) {
  let usd = 0;
  let steps = 0;
  const result = await runAgent(
    r,
    (e) => {
      const s = progress(e);
      if (s) console.log(s);
      if (e.type === "done") {
        usd = e.run_usd;
        steps = e.steps;
      }
    },
    { withAlternativePitch: withPitch },
  );
  return { result, usd, steps };
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

// ---------------------------------------------------------------------------
// Stage 2: LLM judge for theme quality
// ---------------------------------------------------------------------------
const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          employee_id: { type: "string" },
          specificity: { type: "integer" },
          grounded: { type: "integer" },
          fit: { type: "integer" },
          appeal: { type: "integer" },
          comment: { type: "string" },
        },
        required: ["employee_id", "specificity", "grounded", "fit", "appeal", "comment"],
        additionalProperties: false,
      },
    },
  },
  required: ["scores"],
  additionalProperties: false,
};

type Score = { employee_id: string; specificity: number; grounded: number; fit: number; appeal: number; comment: string };

async function judge(runId: string, r: SpeakingRequest, candidates: Array<{ employee_id: string; name: string; theme: string; reason: string; evidence_ids: string[] }>): Promise<Score[]> {
  const acts = new Map(activities().map((a) => [a.id, a]));
  const body = candidates
    .map(
      (c) => `## ${c.employee_id} ${c.name}
テーマ案：${c.theme}
理由：${c.reason}
根拠：
${c.evidence_ids.map((id) => `- ${acts.get(id)?.title}：${acts.get(id)?.body}`).join("\n") || "- （発信済みの記録のみ）"}`,
    )
    .join("\n\n");
  const res = await getClient().messages.create({
    model: chooseModels().loop,
    max_tokens: 4000,
    system: `あなたは技術イベントの登壇テーマを採点する審査員です。依頼と、候補ごとのテーマ案・理由・根拠の投稿を読み、テーマ案の質だけを1〜5の整数で採点します。人選の良し悪しは採点しません。
- specificity：具体的で、聞き手が何を持ち帰れるか分かるタイトルか（広すぎるテーマは低い）
- grounded：根拠の投稿に書かれた事実だけで成り立っているか（投稿にない数字や誇張は低い）
- fit：依頼のテーマ・聴衆・持ち時間に合っているか
- appeal：その聴衆が聞きたくなるか
comment は1文。`,
    messages: [
      {
        role: "user",
        content: `# 依頼\n${JSON.stringify({ event: r.event, theme: r.theme ?? "お任せ", message: r.message }, null, 2)}\n\n# 候補\n${body}`,
      },
    ],
    output_config: { effort: "low", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
  });
  recordUsage(runId, "judge", res.model, res.usage);
  const text = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  return (JSON.parse(text) as { scores: Score[] }).scores;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const scoreOf = (s: Score) => (s.specificity + s.grounded + s.fit + s.appeal) / 4;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const target = args.find((a) => !a.startsWith("--")) ?? "";
  const reportIdx = args.indexOf("--report");
  const reportPath = reportIdx >= 0 ? args[reportIdx + 1] : undefined;
  // --offline: no API calls. Re-check the saved results (docs/eval_latest.json＝最新の実行結果) with the current
  //            validators, data and code (send scan). The write-back test and stage 2 are skipped.
  // --no-quality: run stage 1 for real but skip the LLM scoring (stage 2).
  const offline = args.includes("--offline");
  const noQuality = offline || args.includes("--no-quality");
  const saved = offline
    ? (JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_latest.json"), "utf-8")) as {
        at: string;
        rows: Array<{ request_id: string; result: ProposalResult | null; run_usd: number; steps: number }>;
      })
    : null;
  if (saved) console.log(`オフライン：${saved.at} の保存結果を、今のコード・データ・検証で判定し直します（APIは使いません）`);
  // --from-inbox <id>: data/inbox.json の1件（画面の「手で追加」などで実際に流したもの）を、APIを使わずに受信箱の項目で判定する
  const fromIdx = args.indexOf("--from-inbox");
  const fromInbox = fromIdx >= 0 ? args[fromIdx + 1] : undefined;
  const all = requests();
  const full = target === "all";
  const wantInbox = full || target.split(",").includes("inbox") || !!fromInbox;
  const wantSurvey = full || target.split(",").includes("survey");
  const wantVenues = !fromInbox && (full || target.split(",").includes("venues"));
  // --venue <card_id>: カード → 出し先の1件だけ流す（結果は card_id ごとに最新の結果へ合わせる）
  const venueIdx = args.indexOf("--venue");
  const onlyVenue = venueIdx >= 0 ? args[venueIdx + 1] : undefined;
  const targets = full ? all : all.filter((r) => target.split(",").includes(r.id));
  if (targets.length === 0 && !wantInbox && !wantVenues && !wantSurvey) {
    console.error(
      "使い方: npm run eval -- req001 | req001,req004 | inbox | venues | survey | all [--report docs/eval_after.md] [--no-quality] [--offline] [--from-inbox <受信箱のid>]",
    );
    process.exit(1);
  }
  const expected = loadExpected();
  const names = new Map(employees().map((e) => [e.id, e.name]));
  const actIds = new Set(activities().map((a) => a.id));
  const startTotal = totalUsd();
  const { hits: sendHits, allowed: sendAllowed } = scanForSend();
  const sendOk = sendAllowed.length ? `受付の返信と非公開チャンネルへの通知のほかに送信なし（許可：${sendAllowed.join("、")}）` : "送信の処理・ルートなし";
  const checks: Check[] = [];
  const rows: Array<Record<string, unknown>> = [];
  const results = new Map<string, ProposalResult | null>();

  // ---- stage 1: per request
  for (const r of targets) {
    console.log(`\n=== ${r.id} (${r.pattern}) ${r.event?.title}`);
    const savedRow = saved?.rows.find((x) => x.request_id === r.id);
    const { result, usd, steps } = saved
      ? { result: savedRow?.result ?? null, usd: 0, steps: savedRow?.steps ?? 0 }
      : await propose(r);
    results.set(r.id, result);
    const top3 = result?.candidates.map((c) => c.employee_id) ?? [];
    const exp = expected[r.id] ?? { ids: [] };
    const evidenceIds = result?.candidates.flatMap((c) => c.evidence.map((e) => e.id)) ?? [];
    const badEvidence = evidenceIds.filter((id) => !actIds.has(id));
    const cardIds = (result?.candidates.map((c) => c.card_id).filter(Boolean) as string[]) ?? [];
    const cards = new Set(loadCards().map((c) => c.card_id));
    const badCards = cardIds.filter((id) => !cards.has(id));
    const reqIds = new Set(all.map((x) => x.id));
    for (const c of result?.candidates ?? []) if (c.evidence_request_id && !reqIds.has(c.evidence_request_id)) badCards.push(c.evidence_request_id);
    const anyHit = exp.ids.some((id) => top3.includes(id));
    const primaryHit = exp.primary ? top3.includes(exp.primary) : false;
    const alts = result?.candidates.filter((c) => c.is_alternative_to_nominee).map((c) => c.employee_id) ?? [];
    const altOk = r.nominated_employee_id ? alts.some((id) => exp.ids.includes(id)) : null;

    checks.push({ name: `${r.id} 根拠idが実在`, pass: !!result && badEvidence.length === 0 && badCards.length === 0, detail: [...badEvidence, ...badCards].join(", ") || `${evidenceIds.length}件すべて実在` });
    checks.push({ name: `${r.id} 送信なし`, pass: sendHits.length === 0, detail: sendHits.join(" / ") || sendOk });
    checks.push({ name: `${r.id} 想定候補が候補（5人まで）にいる`, pass: anyHit, detail: `候補=${top3.join(",")} 想定=${exp.ids.join(",")}` });
    checks.push(countCheck(r.id, result));
    const conds = result?.candidates.filter((c) => c.confidence === "conditional") ?? [];
    const noCaveat = conds.filter((c) => !c.caveat?.trim()).map((c) => c.employee_id);
    const badConf = result?.candidates.filter((c) => c.confidence !== "strong" && c.confidence !== "conditional").map((c) => c.employee_id) ?? [];
    checks.push({
      name: `${r.id} 条件付きの候補に引っかかる点の文がある`,
      pass: !!result && noCaveat.length === 0 && badConf.length === 0,
      detail: conds.length ? `条件付き${conds.length}人${noCaveat.length ? `、文なし: ${noCaveat.join(",")}` : "すべて文あり"}` : "条件付きの候補なし",
    });
    const plainErrs = result ? userFacingTextProblems(result) : ["結果なし"];
    checks.push({
      name: `${r.id} 使う人向けの文に内部の言葉がない`,
      pass: plainErrs.length === 0,
      detail: plainErrs.join(" / ") || "内部の項目名・値・idなし",
    });
    const dateErrs = result ? cautionDateProblems(r, result.candidates) : ["結果なし"];
    checks.push({
      name: `${r.id} 注意点の日付が開催日と食い違わない`,
      pass: dateErrs.length === 0,
      detail: dateErrs.join(" / ") || `開催日 ${r.event?.date ?? "なし"} と矛盾なし`,
    });
    if (altOk !== null) checks.push({ name: `${r.id} 代わりの提案`, pass: altOk, detail: `代わり=${alts.join(",") || "なし"}` });
    if (r.nominated_employee_id) {
      const nominee = result?.candidates.find((c) => c.employee_id === r.nominated_employee_id);
      checks.push({
        name: `${r.id} 指名された本人が候補にいる`,
        pass: !!nominee && nominee.is_nominee && nominee.evidence_request_id === r.id,
        detail: nominee
          ? `${nominee.rank}位・${nominee.confidence}${nominee.caveat ? `：${nominee.caveat}` : ""}`
          : `${r.nominated_employee_id} が候補にいない`,
      });
    }

    console.log(
      `  候補${result?.candidates.length ?? 0}人: ${result?.candidates.map((c) => `${c.employee_id} ${c.name}[${c.confidence}・${c.talk_tag ?? "印なし"}]`).join(" / ") || "(なし)"}${result?.no_fit ? `（見つからない理由: ${result.no_fit.reasons[0]}）` : ""}`,
    );
    for (const c of conds) console.log(`    条件付き ${c.name}：${c.caveat}`);
    console.log(`  想定のいずれか=${anyHit ? "○" : "×"} 主候補=${primaryHit ? "○" : "×"}${altOk === null ? "" : ` 代わりの提案=${altOk ? "○" : "×"}`}  $${usd.toFixed(3)}（${steps}回）`);
    rows.push({ request_id: r.id, pattern: r.pattern, top3, expected: exp.ids, primary: exp.primary, any_hit: anyHit, primary_hit: primaryHit, alternatives: alts, alternative_ok: altOk, run_usd: usd, steps, result });
  }

  // ---- 受信箱経由の指名あり依頼（依頼文から指名を読み取り、社員データで確かめ、既存の流れで候補を出す）
  let inboxCaseOut: Record<string, unknown> | null = null;
  if (wantInbox) {
    const savedCase = (saved as unknown as { inbox_case?: { item: InboxItem; source: string } } | null)?.inbox_case;
    let item: InboxItem | undefined;
    let source = "";
    if (fromInbox) {
      item = getInboxItem(fromInbox);
      source = `受信箱の実データ（${fromInbox}）`;
    } else if (offline) {
      item = savedCase?.item;
      source = savedCase ? `保存結果（${savedCase.source}）` : "";
    } else {
      // 本物の Agent で流す。書き込みは一時ファイルにして data/inbox.json には触らない
      const tmp = path.join(process.cwd(), "eval-results", `inbox-eval-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(tmp), { recursive: true });
      const prevFile = process.env.INBOX_FILE;
      process.env.INBOX_FILE = tmp;
      try {
        console.log(`\n=== 受信箱経由の指名あり依頼（${INBOX_CASE.based_on} と同じ内容を本文だけで）`);
        const reg = registerInbox({ text: INBOX_CASE.text, source: "manual" });
        await prepare(
          reg.id,
          (request, emit) =>
            runAgent(request, (e) => {
              const s = progress(e);
              if (s) console.log(s);
              emit(e);
            }),
          extractIntakeWithAgent,
        );
        item = getInboxItem(reg.id);
        source = "評価スクリプトで実行";
      } finally {
        if (prevFile === undefined) delete process.env.INBOX_FILE;
        else process.env.INBOX_FILE = prevFile;
        fs.rmSync(tmp, { force: true });
      }
    }
    if (!item) {
      checks.push({ name: "受信箱経由の指名あり依頼", pass: false, detail: fromInbox ? `受信箱に ${fromInbox} がない` : "保存結果がない（一度 APIありで流してください）" });
    } else {
      const res = item.result;
      const exp = expected[INBOX_CASE.based_on] ?? { ids: [] };
      const top3 = res?.candidates.map((c) => c.employee_id) ?? [];
      const nominee = res?.candidates.find((c) => c.employee_id === INBOX_CASE.nominee);
      const evIds = res?.candidates.flatMap((c) => c.evidence.map((e) => e.id)) ?? [];
      const plainErrs = res ? userFacingTextProblems(res) : ["結果なし"];
      checks.push({ name: "受信箱：準備済みになる", pass: item.status === "ready" && !!res, detail: item.status + (item.error ? `（${item.error}）` : "") });
      checks.push({
        name: "受信箱：依頼文から指名を読み取り、社員データで確かめる",
        pass: item.nominee?.employee_id === INBOX_CASE.nominee,
        detail: `読み取り「${item.nominee?.name ?? "なし"}」→ ${item.nominee?.employee_id ?? "指名なし"}${item.nominee?.note ? `（${item.nominee.note}）` : ""}`,
      });
      checks.push({
        name: "受信箱：指名された本人が候補にいる",
        pass: !!nominee && nominee.is_nominee && nominee.evidence_request_id === item.id,
        detail: nominee ? `${nominee.rank}位・${nominee.confidence}${nominee.caveat ? `：${nominee.caveat}` : ""}` : `${INBOX_CASE.nominee} が候補にいない`,
      });
      checks.push({ name: "受信箱：想定候補が候補（5人まで）にいる", pass: exp.ids.some((id) => top3.includes(id)), detail: `候補=${top3.join(",")} 想定=${exp.ids.join(",")}` });
      checks.push(countCheck("受信箱", res ?? null));
      checks.push({ name: "受信箱：根拠idが実在", pass: evIds.every((id) => actIds.has(id)), detail: `${evIds.length}件` });
      checks.push({ name: "受信箱：使う人向けの文に内部の言葉がない", pass: plainErrs.length === 0, detail: plainErrs.join(" / ") || "なし" });
      checks.push({ name: "受信箱：送信なし", pass: sendHits.length === 0, detail: sendHits.join(" / ") || "送信の処理・ルートなし" });
      console.log(`  受信箱（${source}）：指名 ${item.nominee?.employee_id ?? "なし"}／top3 ${top3.map((id) => `${id} ${names.get(id)}`).join(" / ")}`);
      inboxCaseOut = { source: source || "不明", item };
    }
  }

  // ---- カード → 出し先（ネタが先）
  const venueCases: Array<Record<string, unknown>> = [];
  if (wantVenues) {
    const savedVenues = (saved as unknown as { venue_cases?: Array<{ card_id: string; result: VenueResult | null; events: VenueEvent[]; run_usd: number }> } | null)
      ?.venue_cases;
    for (const vc of VENUE_CASES.filter((v) => !onlyVenue || v.card_id === onlyVenue)) {
      console.log(`\n=== カード → 出し先：${vc.label}（${vc.card_id}）`);
      let result: VenueResult | null = null;
      let events: VenueEvent[] = [];
      let usd = 0;
      if (offline) {
        const s = savedVenues?.find((x) => x.card_id === vc.card_id);
        result = s?.result ?? null;
        events = s?.events ?? [];
        usd = 0;
        if (!s) console.log("  保存結果がありません（一度 APIありで流してください）");
      } else {
        result = await findVenues(vc.card_id, (e) => {
          const s = progress(e as AgentEvent);
          if (s) console.log(s);
          if (e.type === "tool_call" || e.type === "tool_result" || e.type === "retry" || e.type === "step") events.push(e);
          if (e.type === "done") usd = e.run_usd;
        });
      }
      const card = loadCards().find((c) => c.card_id === vc.card_id);
      const vs = result?.venues ?? [];
      const closed = vs.filter((v) => {
        const e = externalEventById(v.event_id);
        return !e || isClosed(e);
      });
      const unknownIds = vs.filter((v) => !externalEventById(v.event_id)).map((v) => v.event_id);
      const top = vs[0] ? externalEventById(vs[0].event_id) : undefined;
      const topText = top ? `${top.name} ${themesOf(top).join(" ")}` : "";
      const fits = !!top && vc.expect.some((k) => topText.includes(k));
      const missingNotes = vs.filter((v) => {
        const e = externalEventById(v.event_id);
        if (!e) return false;
        return (e.cfp_status === "unknown" && !v.cautions.includes("締切は公式で要確認")) || (!e.event_date && !v.cautions.includes("開催日は要確認"));
      });
      const badEv = vs.flatMap((v) => v.evidence.map((x) => x.id)).filter((id) => !card?.evidence_activity_ids.includes(id));
      const plain = result
        ? internalTermProblems([
            { where: "summary", text: result.summary },
            ...vs.flatMap((v) => [v.theme, v.reason, v.caveat ?? "", ...v.cautions].map((t) => ({ where: v.name, text: t }))),
            ...(result.no_fit?.reasons ?? []).map((t) => ({ where: "no_fit", text: t })),
          ])
        : ["結果なし"];
      const tag = `出し先（${vc.card_id}）`;
      checks.push({ name: `${tag} 結果が出る`, pass: !!result && vs.length > 0, detail: result ? `${vs.length}件${result.no_fit ? "（見つからない理由あり）" : ""}` : "結果なし" });
      checks.push({ name: `${tag} 締切済みを出さない`, pass: !!result && closed.length === 0, detail: closed.map((v) => v.name).join(",") || vs.map((v) => `${v.name}（${v.cfp_status}）`).join("、") });
      checks.push({ name: `${tag} イベントidが実在`, pass: !!result && unknownIds.length === 0, detail: unknownIds.join(",") || vs.map((v) => v.event_id).join(",") });
      checks.push({ name: `${tag} テーマが合う`, pass: fits, detail: top ? `1件目：${top.name}（${themesOf(top).join("・")}）` : "出し先なし" });
      checks.push({ name: `${tag} 未確認の締切・開催日を注意点に書く`, pass: !!result && missingNotes.length === 0, detail: missingNotes.map((v) => v.name).join(",") || "すべて記載" });
      checks.push({ name: `${tag} 根拠がカードのもとになった活動`, pass: !!result && badEv.length === 0, detail: badEv.join(",") || "すべてカードの根拠" });
      checks.push({ name: `${tag} 内部の言葉がない`, pass: plain.length === 0, detail: plain.join(" / ") || "なし" });
      console.log(`  ${vs.map((v) => `${v.rank}. ${v.name}[${v.confidence}]`).join(" / ") || "（出し先なし）"}${result?.blog ? `／ブログ案「${result.blog.title}」` : ""}  $${usd.toFixed(3)}`);
      venueCases.push({ card_id: vc.card_id, result, events, run_usd: usd });
    }
  }

  let coverage: { covered: number; total: number; missing: string[] } | null = null;
  let writeback: Record<string, unknown> | null = null;

  if (full) {
    // ---- notebook coverage (unpublished cards only)
    const untold = loadUntold();
    const ev = new Set(loadCards().filter((c) => c.publication_status === "unpublished").flatMap((c) => c.evidence_activity_ids));
    const missing = untold.filter((id) => !ev.has(id));
    coverage = { covered: untold.length - missing.length, total: untold.length, missing };
    checks.push({ name: "ネタ帳：未発信の取り組みがカードになっている（15件以上）", pass: coverage.covered >= 15, detail: `${coverage.covered}/${coverage.total}${missing.length ? ` 未カード化: ${missing.join(",")}` : ""}` });

    // ---- write-back: decline on the top card, run the same request again, then undo
    const before = results.get(WRITEBACK_REQUEST);
    const top = before?.candidates[0];
    if (offline) {
      console.log("\n（オフラインのため書き戻しテストは省略）");
    } else if (top?.card_id) {
      const req = all.find((x) => x.id === WRITEBACK_REQUEST)!;
      const testId = `${WRITEBACK_REQUEST}`;
      console.log(`\n=== 書き戻しテスト：${top.name}（${top.card_id}）に「辞退：忙しい」を記録して ${WRITEBACK_REQUEST} をもう一度`);
      appendOutreach(top.card_id, { request_id: testId, result: "declined", reason: "busy", event_date: req.event?.date ?? null });
      try {
        const again = await propose(req, false);
        const beforeTop = before!.candidates.map((c) => c.employee_id);
        const afterTop = again.result?.candidates.map((c) => c.employee_id) ?? [];
        const oldRank = beforeTop.indexOf(top.employee_id);
        const newRank = afterTop.indexOf(top.employee_id);
        const changed = afterTop[0] !== top.employee_id && (newRank === -1 || newRank > oldRank);
        const mentioned = (again.result?.learnings_applied ?? []).some((t) => t.includes(top.name.split(" ")[0]) || t.includes("辞退"));
        writeback = { declined: top.employee_id, before: beforeTop, after: afterTop, learnings_applied: again.result?.learnings_applied ?? [], run_usd: again.usd };
        checks.push({ name: "書き戻し後に提案が変わる", pass: changed, detail: `前 ${beforeTop.join(",")} → 後 ${afterTop.join(",")}${mentioned ? "（打診履歴の反映を明記）" : ""}` });
        console.log(`  前: ${beforeTop.join(", ")} → 後: ${afterTop.join(", ")}  $${again.usd.toFixed(3)}`);
      } finally {
        removeOutreach(top.card_id, testId); // leave the notebook as it was
      }
    } else {
      checks.push({ name: "書き戻し後に提案が変わる", pass: false, detail: `${WRITEBACK_REQUEST} の1位にカードがない` });
    }
  }

  // ---- イベント後のアンケート（v0.4）。中身は scripts/eval_survey.ts
  let surveyCase: Record<string, unknown> | null = null;
  if (wantSurvey) {
    checks.push(...(await surveyCodeChecks()));
    if (offline) console.log("\n（オフラインのためアンケートの書き戻しテストは省略）");
    else {
      const req = all.find((x) => x.id === SURVEY_REQUEST)!;
      const s = await surveyLiveCheck(req, results.get(SURVEY_REQUEST) ?? null, (r) => propose(r, false));
      checks.push(...s.checks);
      surveyCase = s.record;
    }
  }

  const passed = checks.filter((c) => c.pass).length;
  const rate = checks.length ? passed / checks.length : 0;
  console.log(`\n=== 段階1 結合テスト：${passed}/${checks.length}（${Math.round(rate * 100)}%）${rate >= PASS_RATE ? "合格" : "不合格"}`);
  for (const c of checks) console.log(`${c.pass ? "○" : "×"} ${c.name}：${c.detail}`);

  // ---- stage 2: LLM judge, before vs after
  let quality: Array<Record<string, unknown>> | null = null;
  if (full && !noQuality) {
    console.log(`\n=== 段階2 テーマ案の質（LLM採点、before と after を同じ審査で採点）`);
    const beforeFile = path.join(process.cwd(), "docs", "eval_before.json");
    const before = JSON.parse(fs.readFileSync(beforeFile, "utf-8")) as { rows: Array<{ request_id: string; result: ProposalResult }> };
    const judgeRun = randomUUID();
    quality = [];
    for (const r of targets) {
      const b = before.rows.find((x) => x.request_id === r.id)?.result;
      const a = results.get(r.id);
      const toCands = (p: ProposalResult | null | undefined) =>
        (p?.candidates ?? []).map((c) => ({ employee_id: c.employee_id, name: c.name, theme: c.theme, reason: c.reason, evidence_ids: c.evidence.map((e) => e.id) }));
      const bs = b ? await judge(judgeRun, r, toCands(b)) : [];
      const as = a ? await judge(judgeRun, r, toCands(a)) : [];
      const row = { request_id: r.id, before: avg(bs.map(scoreOf)), after: avg(as.map(scoreOf)), before_scores: bs, after_scores: as };
      quality.push(row);
      console.log(`${r.id}  before ${row.before.toFixed(2)}  after ${row.after.toFixed(2)}  差 ${(row.after - row.before >= 0 ? "+" : "") + (row.after - row.before).toFixed(2)}`);
    }
    console.log(`採点の金額: $${runUsd(judgeRun).toFixed(3)}`);
  }

  const spent = totalUsd() - startTotal;
  console.log(`\n今回の評価で使った金額: $${spent.toFixed(3)}／累計: $${totalUsd().toFixed(3)}`);

  const out = {
    at: new Date().toISOString(),
    version: "v0.3",
    mode: offline ? "offline" : fromInbox ? "from-inbox" : noQuality ? "stage1" : "full",
    spent_usd: spent,
    pass_rate: rate,
    checks,
    rows,
    coverage,
    writeback,
    quality,
    inbox_case: inboxCaseOut,
    survey_case: surveyCase,
    ...(wantVenues ? { venue_cases: venueCases } : {}),
  };
  // 受信箱の実データで判定したら、その結果を最新の結果に足しておく（--offline でも判定できるように）
  if (fromInbox && inboxCaseOut) {
    const latestFile = path.join(process.cwd(), "docs", "eval_latest.json");
    const latest = JSON.parse(fs.readFileSync(latestFile, "utf-8"));
    fs.writeFileSync(latestFile, JSON.stringify({ ...latest, inbox_case: inboxCaseOut }, null, 2));
    console.log("受信箱の結果を docs/eval_latest.json に足しました");
  }
  // 出し先だけを実際に流したときも、最新の結果に足しておく（--offline と ?mock の元データ）
  if (wantVenues && !offline && !full && venueCases.length) {
    const latestFile = path.join(process.cwd(), "docs", "eval_latest.json");
    const latest = JSON.parse(fs.readFileSync(latestFile, "utf-8"));
    const merged = [...((latest.venue_cases ?? []) as Array<{ card_id: string }>).filter((x) => !venueCases.some((v) => v.card_id === x.card_id)), ...venueCases];
    fs.writeFileSync(latestFile, JSON.stringify({ ...latest, venue_cases: merged }, null, 2));
    console.log("出し先の結果を docs/eval_latest.json に足しました（scripts/update_mock.ts で ?mock に反映）");
  }
  if (offline && reportPath) {
    console.error("--offline では --report を使えません（保存結果を上書きしないため）");
    process.exitCode = 1;
    return;
  }
  const dir = path.join(process.cwd(), "eval-results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `eval-v02-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`結果: ${path.relative(process.cwd(), file)}`);
  // 依頼5件そろった実際の実行は、最新の結果として残す（--offline と ?mock の元データ）
  if (!offline && rows.length === all.length) {
    fs.writeFileSync(path.join(process.cwd(), "docs", "eval_latest.json"), JSON.stringify(out, null, 2));
    console.log("最新の結果: docs/eval_latest.json（--offline と scripts/update_mock.ts が読む）");
  }
  if (reportPath) {
    fs.writeFileSync(path.join(process.cwd(), reportPath.replace(/\.md$/, ".json")), JSON.stringify(out, null, 2));
    console.log(`生データ: ${reportPath.replace(/\.md$/, ".json")}（レポートは scripts/eval_report.ts で作成）`);
  }
  if (rate < PASS_RATE) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
