// 評価（docs/evals.md）の安定性：優先度の高いケースを k 回流し、毎回通った割合を出す（API を使う。オンライン）。
//   TRY_ENV_FILE=<.env の場所> npm run eval:passk                         … 重み 6 以上のケースを 3 回ずつ
//   npm run eval:passk -- --k 3 --only edge-N4,edge-J1 --max-usd 1.0 --judge
//   npm run eval:passk -- --list                                           … 対象の一覧と、金額の見込みだけ（API は使わない）
// - 受信箱に貼ったときと同じ流れ（読み取り → 候補づくり）。--judge を付けると、AI に判定させる観点があるケースで下書きも作って判定する
// - .env はこのプロセスにだけ読む。キーの値は表示しない。受信箱と実行時のデータは一時フォルダ（カードには書かない）
// - 上限（--max-usd、既定 1.0）を超えそうなら、その先を流さずに止まる
// - 判定はコード（scripts/evals/checks.ts）。1回ごとに、ケースの判定がすべて通ったかを見る
// - 結果は docs/evals_passk.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CheckResult, EvalCase, EvalOutput } from "../../lib/evalTypes";
import { caseVerdict, isHighPriority, priorityWeight, withinAllowedFailures } from "../../lib/evalTypes";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const K = Number(opt("--k") ?? "3");
const MAX_USD = Number(opt("--max-usd") ?? "1.0");
const ONLY = (opt("--only") ?? "").split(",").filter(Boolean);
const WITH_JUDGE = args.includes("--judge");
const LIST = args.includes("--list");
/** 1回の読み取り＋候補づくりの見込み（今までの記録の上のほう）と、下書き1回の見込み */
const RUN_MAX_USD = 0.2;
const DRAFT_MAX_USD = 0.21;
const OUT = path.join(process.cwd(), "docs", "evals_passk.json");

async function main() {
  const envFile = process.env.TRY_ENV_FILE || ".env";
  if (!LIST) {
    if (!fs.existsSync(envFile)) {
      console.error(`${envFile} がありません（TRY_ENV_FILE で場所を指定）`);
      process.exit(1);
    }
    process.loadEnvFile(envFile);
  }
  for (const k of ["DATA_SOURCE", "DEMO_PERSON", "SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD"]) delete process.env[k];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "evals-passk-"));
  process.env.INBOX_FILE = path.join(tmpDir, "inbox.json");
  process.env.DATA_RUNTIME_DIR = path.join(tmpDir, "runtime");
  process.env.DRAFTS_FILE = path.join(tmpDir, "drafts.json");
  process.env.FIXED_TODAY ??= "2026-11-21";

  const { edgeCases, raiseCases, usageKeepCases } = await import("./cases");
  const { runChecks } = await import("./checks");
  const all: EvalCase[] = [...edgeCases(), ...usageKeepCases(), ...raiseCases()];
  // 対象：流せる入力（受信箱の文・サンプルの依頼）で、入口で断られないもの。--only がなければ優先度の高いもの
  const targets = all
    .filter((c) => (ONLY.length ? ONLY.includes(c.id) : isHighPriority(c.priority)))
    .filter((c) => c.input.kind !== "venue" && !c.checks.includes("entry_rejected"));
  console.log(`対象 ${targets.length}件 × ${K}回（上限 $${MAX_USD}。1回の見込み 約 $${RUN_MAX_USD}${WITH_JUDGE ? `、下書きと AI の判定つきは ＋約 $${DRAFT_MAX_USD}` : ""}）`);
  for (const c of targets) console.log(`  ${c.id}（重み ${priorityWeight(c.priority)}・許せる失敗率 ${c.allowed_failure_rate}）${c.title}`);
  if (LIST) {
    console.log(`全部流すと 約 $${(targets.length * K * RUN_MAX_USD).toFixed(1)} まで。--only と --max-usd で絞れます`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return;
  }

  const { registerInbox, prepare, getInboxItem } = await import("../../lib/inbox");
  const { extractIntakeWithAgent } = await import("../../lib/intake");
  const { runAgent } = await import("../../lib/agent");
  const { resolveRequest } = await import("../../lib/requests");
  const { draftOutreach } = await import("../../lib/heavy");
  const { totalUsd } = await import("../../lib/usage");
  const { judgeCase, realJudgeCall } = await import("./judge");
  const t0 = totalUsd();
  const spent = () => totalUsd() - t0;

  /** 1回流して、結果（EvalOutput）にする */
  async function runOnce(c: EvalCase): Promise<EvalOutput> {
    let out: EvalOutput;
    let requestId: string;
    if (c.input.kind === "inbox") {
      const reg = registerInbox({ text: c.input.text, source: c.input.channel ?? "manual" });
      await prepare(reg.id, (request, emit) => runAgent(request, emit), extractIntakeWithAgent);
      const it = getInboxItem(reg.id)!;
      out = { status: it.status, intake: it.intake ?? null, result: it.result };
      requestId = reg.id;
    } else if (c.input.kind === "request") {
      const request = resolveRequest({ request_id: c.input.request_id })!;
      out = { status: "ready", result: await runAgent(request, () => undefined) };
      requestId = c.input.request_id;
    } else throw new Error("出し先のケースは流せません");
    // AI に判定させる観点（声かけ文など）があるときだけ、下書きを作る
    const first = out.result?.candidates[0];
    if (WITH_JUDGE && c.judge?.some((j) => j.target !== "candidates") && first && spent() + DRAFT_MAX_USD <= MAX_USD) {
      const request = resolveRequest({ request_id: requestId })!;
      const d = await draftOutreach(requestId, request, { employee_id: first.employee_id, theme: first.theme, reason: first.reason, evidence_activity_ids: first.evidence.map((e) => e.id) });
      out.draft = { subject: d.value.subject, message: d.value.message, organizer_reply: d.value.organizer_reply ?? null, organizer_reply_note: d.value.organizer_reply_note ?? null };
    }
    return out;
  }

  const rows: unknown[] = [];
  let stopped: string | null = null;
  try {
    for (const c of targets) {
      const runs: Array<{ passed: boolean | null; failed: string[]; unknown: string[]; usd: number }> = [];
      for (let i = 0; i < K; i++) {
        if (spent() + RUN_MAX_USD > MAX_USD) {
          stopped = `上限 $${MAX_USD} を超えそうなので、${c.id} の ${i + 1} 回目から先は流していない（ここまで $${spent().toFixed(3)}）`;
          break;
        }
        const before = spent();
        let checks: CheckResult[];
        try {
          const o = await runOnce(c);
          checks = [...runChecks(c, o), ...(WITH_JUDGE && c.judge?.length ? await judgeCase(c, o, await realJudgeCall(`judge-${c.id}`)) : [])];
        } catch (e) {
          checks = [{ name: "流す", verdict: "fail", detail: e instanceof Error ? e.message : String(e) }];
        }
        runs.push({ passed: caseVerdict(checks), failed: checks.filter((x) => x.verdict === "fail").map((x) => `${x.name}：${x.detail ?? ""}`), unknown: checks.filter((x) => x.verdict === "unknown").map((x) => x.name), usd: Number((spent() - before).toFixed(4)) });
        console.log(`# ${c.id} ${i + 1}/${K}：${runs.at(-1)!.passed === null ? "分からない" : runs.at(-1)!.passed ? "通った" : `落ちた（${runs.at(-1)!.failed[0]?.slice(0, 80)}）`}／$${runs.at(-1)!.usd}（累計 $${spent().toFixed(3)}）`);
      }
      const judged = runs.filter((r) => r.passed !== null);
      const passes = judged.filter((r) => r.passed).length;
      rows.push({
        id: c.id,
        title: c.title,
        weight: priorityWeight(c.priority),
        allowed_failure_rate: c.allowed_failure_rate,
        runs: runs.length,
        passes,
        /** 毎回通ったか（k 回すべて） */
        passed_every_time: judged.length > 0 && judged.length === runs.length && passes === judged.length,
        /** 許せる失敗率の中か */
        within_allowed: withinAllowedFailures(passes, judged.length, c.allowed_failure_rate),
        detail: runs,
      });
      fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), k: K, max_usd: MAX_USD, spent_usd: Number(spent().toFixed(4)), stopped, rows }, null, 2) + "\n");
      if (stopped) break;
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const done = rows as Array<{ runs: number; passed_every_time: boolean; within_allowed: boolean }>;
  const full = done.filter((r) => r.runs === K);
  console.log(`\n毎回通ったケース：${full.filter((r) => r.passed_every_time).length}/${full.length}件（${K}回すべて流せたもの）。許せる失敗率の中：${full.filter((r) => r.within_allowed).length}/${full.length}件`);
  if (stopped) console.log(stopped);
  console.log(`今回 $${spent().toFixed(3)}（上限 $${MAX_USD}）／保存：docs/evals_passk.json`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
