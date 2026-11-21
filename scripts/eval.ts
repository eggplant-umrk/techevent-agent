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
// Uses API credits. The key is read from .env into this process only.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { cautionDateProblems, runAgent, userFacingTextProblems, type AgentEvent, type ProposalResult } from "../lib/agent";
import { getClient } from "../lib/anthropic";
import { appendOutreach, loadCards, removeOutreach } from "../lib/cards";
import { activities, employees, requests, type SpeakingRequest } from "../lib/data";
import { chooseModels, recordUsage, runUsd, totalUsd } from "../lib/usage";

process.loadEnvFile(".env");

const PASS_RATE = 0.9;
const WRITEBACK_REQUEST = "req003";

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
// "Nothing is sent": static scan of the app for outbound messaging
// ---------------------------------------------------------------------------
const SEND_PATTERNS = [/slack\.com\/api/i, /chat\.postMessage/, /hooks\.slack\.com/i, /nodemailer/i, /sendMail\s*\(/, /smtp/i, /sendgrid/i, /twilio/i];

function scanForSend(): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f.name)) {
        const src = fs.readFileSync(p, "utf-8");
        for (const re of SEND_PATTERNS) if (re.test(src)) hits.push(`${path.relative(process.cwd(), p)}: ${re}`);
      }
    }
  };
  for (const dir of ["app", "lib", "components"]) {
    if (fs.existsSync(path.join(process.cwd(), dir))) walk(path.join(process.cwd(), dir));
  }
  const routes = fs.readdirSync(path.join(process.cwd(), "app", "api"));
  for (const r of routes) if (/send|post|mail|notify|slack/i.test(r)) hits.push(`app/api/${r}: send-like route`);
  return hits;
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
  // --offline: no API calls. Re-check the saved results (docs/eval_after.json) with the current
  //            validators, data and code (send scan). The write-back test and stage 2 are skipped.
  // --no-quality: run stage 1 for real but skip the LLM scoring (stage 2).
  const offline = args.includes("--offline");
  const noQuality = offline || args.includes("--no-quality");
  const saved = offline
    ? (JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_after.json"), "utf-8")) as {
        at: string;
        rows: Array<{ request_id: string; result: ProposalResult | null; run_usd: number; steps: number }>;
      })
    : null;
  if (saved) console.log(`オフライン：${saved.at} の保存結果を、今のコード・データ・検証で判定し直します（APIは使いません）`);
  const all = requests();
  const full = target === "all";
  const targets = full ? all : all.filter((r) => target.split(",").includes(r.id));
  if (targets.length === 0) {
    console.error("使い方: npm run eval -- req001 | req001,req004 | all [--report docs/eval_after.md] [--no-quality] [--offline]");
    process.exit(1);
  }
  const expected = loadExpected();
  const names = new Map(employees().map((e) => [e.id, e.name]));
  const actIds = new Set(activities().map((a) => a.id));
  const startTotal = totalUsd();
  const sendHits = scanForSend();
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
    checks.push({ name: `${r.id} 送信なし`, pass: sendHits.length === 0, detail: sendHits.join(" / ") || "送信の処理・ルートなし" });
    checks.push({ name: `${r.id} 想定候補が上位3人`, pass: anyHit, detail: `top3=${top3.join(",")} 想定=${exp.ids.join(",")}` });
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
      `  top3: ${result?.candidates.map((c) => `${c.employee_id} ${c.name}[${c.confidence}]`).join(" / ") || "(なし)"}${result?.no_fit ? `（3人未満: ${result.no_fit.reasons[0]}）` : ""}`,
    );
    for (const c of conds) console.log(`    条件付き ${c.name}：${c.caveat}`);
    console.log(`  想定のいずれか=${anyHit ? "○" : "×"} 主候補=${primaryHit ? "○" : "×"}${altOk === null ? "" : ` 代わりの提案=${altOk ? "○" : "×"}`}  $${usd.toFixed(3)}（${steps}回）`);
    rows.push({ request_id: r.id, pattern: r.pattern, top3, expected: exp.ids, primary: exp.primary, any_hit: anyHit, primary_hit: primaryHit, alternatives: alts, alternative_ok: altOk, run_usd: usd, steps, result });
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

  const out = { at: new Date().toISOString(), version: "v0.2", mode: offline ? "offline" : noQuality ? "stage1" : "full", spent_usd: spent, pass_rate: rate, checks, rows, coverage, writeback, quality };
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
