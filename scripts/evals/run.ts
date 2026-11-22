import "../_isolate"; // 元のデータだけで動かす（実行時のデータ・金額の記録は一時ファイル）
// 評価（docs/evals.md）を流す。API は使わない（保存済みの結果と、今のコードの判定）。
//   npm run eval:keep                 … 保つ評価。点数が 90% を切ったら失敗（終了コード 1）
//   npm run eval:raise                … 上げる評価。点数を出すだけ（失敗にしない）
//   npm run eval:compare              … 上げる評価の点数を main（origin/main の docs/evals_baseline.json）と比べ、5% 以上下がったら失敗
//   npm run eval:compare -- --update  … 今の点数を docs/evals_baseline.json に書く（main に入れる前に流す）
//   どれも --json <ファイル> で結果を書き出せる。--verbose で通った判定も出す
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { CaseResult, EvalCase } from "../../lib/evalTypes";
import { evalCaseProblems, KEEP_PASS_RATE, RAISE_MAX_DROP, weightedScore } from "../../lib/evalTypes";
import { CHECK_NAMES } from "./checks";
import { edgeCases, judgeOffline, legacyCases, promotedCases, raiseCases, usageKeepCases } from "./cases";

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("-")) ?? "keep";
const verbose = args.includes("--verbose");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;
const BASELINE = path.join(process.cwd(), "docs", "evals_baseline.json");
const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

export interface SuiteReport {
  suite: "keep" | "raise";
  score: number | null;
  cases: number;
  judged: number;
  passed: number;
  failed: number;
  unknown: number;
  results: CaseResult[];
  problems: string[];
}

function report(suite: "keep" | "raise", cases: EvalCase[], results: CaseResult[], problems: string[]): SuiteReport {
  const judged = results.filter((r) => r.passed !== null);
  return { suite, score: weightedScore(results), cases: cases.length, judged: judged.length, passed: judged.filter((r) => r.passed).length, failed: judged.filter((r) => !r.passed).length, unknown: results.length - judged.length, results, problems };
}

export function runKeep(): SuiteReport {
  const legacy = legacyCases();
  const others = [...edgeCases(), ...promotedCases(), ...usageKeepCases()];
  const cases = [...legacy.cases, ...others];
  const problems = cases.flatMap((c) => evalCaseProblems(c, [...CHECK_NAMES, "legacy_integration"]));
  if (legacy.unmatched.length) problems.push(`結合テストの判定のうち、どのケースにも入らなかったもの：${legacy.unmatched.map((c) => c.name).join("、")}`);
  return report("keep", cases, [...legacy.results, ...others.map(judgeOffline)], problems);
}

export function runRaise(): SuiteReport {
  const cases = raiseCases();
  return report("raise", cases, cases.map(judgeOffline), cases.flatMap((c) => evalCaseProblems(c, CHECK_NAMES)));
}

function print(r: SuiteReport, cases: Map<string, EvalCase>) {
  console.log(`\n=== ${r.suite === "keep" ? "保つ評価" : "上げる評価"}：点数 ${pct(r.score)}（${r.cases}件。合格 ${r.passed}・不合格 ${r.failed}・分からない ${r.unknown}）`);
  for (const x of r.results) {
    const mark = x.passed === null ? "？" : x.passed ? "○" : "×";
    const c = cases.get(x.id);
    console.log(`${mark} ${x.id}（重み ${x.weight}）${c ? ` ${c.title}` : ""}`);
    for (const k of x.checks) {
      if (k.verdict === "fail" || (verbose && k.verdict !== "unknown")) console.log(`    ${k.verdict === "fail" ? "×" : "○"} ${k.name}${k.detail ? `：${k.detail}` : ""}`);
    }
    if (x.passed === null) console.log(`    （材料がなく、判定できていない：${[...new Set(x.checks.map((k) => k.detail))].slice(0, 2).join("／")}）`);
  }
  for (const p of r.problems) console.log(`！ ケースの形：${p}`);
}

/** main の点数：origin/main の docs/evals_baseline.json（なければ、この作業場所のファイル） */
interface Baseline {
  raise: number | null;
  keep: number | null;
  at?: string;
  /** 上げる評価のケースごとの合否（古い基準にはない） */
  raise_results?: Array<{ id: string; weight: number; passed: boolean | null }>;
}
function mainBaseline(): (Baseline & { from: string }) | null {
  const g = spawnSync("git", ["show", "origin/main:docs/evals_baseline.json"], { cwd: process.cwd(), encoding: "utf-8" });
  if (g.status === 0 && g.stdout.trim()) return { ...(JSON.parse(g.stdout) as Baseline), from: "origin/main" };
  if (fs.existsSync(BASELINE)) return { ...(JSON.parse(fs.readFileSync(BASELINE, "utf-8")) as Baseline), from: "この作業場所の docs/evals_baseline.json" };
  return null;
}

function main() {
  const allCases = new Map<string, EvalCase>();
  let exit = 0;
  const out: Record<string, unknown> = { at: new Date().toISOString(), mode };
  if (mode === "keep" || mode === "all") {
    const r = runKeep();
    for (const c of [...legacyCases([]).cases, ...edgeCases(), ...promotedCases(), ...usageKeepCases()]) allCases.set(c.id, c);
    print(r, allCases);
    out.keep = r;
    const ok = r.score !== null && r.score >= KEEP_PASS_RATE && r.problems.length === 0;
    console.log(`保つ評価：${pct(r.score)}（${pct(KEEP_PASS_RATE)} 以上で合格）→ ${ok ? "合格" : "不合格"}`);
    if (!ok) exit = 1;
  }
  if (mode === "raise" || mode === "compare" || mode === "all") {
    const r = runRaise();
    for (const c of raiseCases()) allCases.set(c.id, c);
    print(r, allCases);
    out.raise = r;
    if (r.problems.length) exit = 1;
    if (mode === "compare") {
      if (args.includes("--update")) {
        const keep = runKeep();
        // 上げる評価はケースごとの合否も残す（ケースを足した・移したときに、main と同じケースだけで比べられるように）
        const raise_results = r.results.map((x) => ({ id: x.id, weight: x.weight, passed: x.passed }));
        fs.writeFileSync(BASELINE, JSON.stringify({ at: new Date().toISOString(), keep: keep.score, raise: r.score, raise_cases: r.cases, raise_judged: r.judged, keep_cases: keep.cases, raise_results }, null, 2) + "\n");
        console.log(`docs/evals_baseline.json に書きました（保つ ${pct(keep.score)}・上げる ${pct(r.score)}）`);
      } else {
        const base = mainBaseline();
        if (!base || base.raise === null || base.raise === undefined) console.log("main の点数（docs/evals_baseline.json）がないので、比べていません");
        else if (r.score === null) console.log("上げる評価に、判定できたケースがないので、比べていません");
        else {
          // main にケースごとの合否があれば、両方にあるケースだけで比べる（ケースを足した・保つ評価に移しただけで「下がった」にしない）
          const mainResults = base.raise_results;
          const nowIds = new Set(r.results.map((x) => x.id));
          const common = mainResults ? mainResults.filter((x) => nowIds.has(x.id)).map((x) => x.id) : null;
          const mainScore = common ? weightedScore(mainResults!.filter((x) => common.includes(x.id))) : base.raise;
          const nowScore = common ? weightedScore(r.results.filter((x) => common.includes(x.id))) : r.score;
          if (common) {
            const removed = mainResults!.filter((x) => !nowIds.has(x.id)).map((x) => x.id);
            const added = r.results.filter((x) => !mainResults!.some((m) => m.id === x.id)).map((x) => x.id);
            console.log(`両方にあるケース ${common.length}件で比べます${removed.length ? `（main にだけある：${removed.join("、")}）` : ""}${added.length ? `（いまだけある：${added.join("、")}）` : ""}`);
          } else console.log("main の基準にケースごとの合否がないので、全体の点数で比べます（ケースを足した・移した直後は、そのぶん点数が動きます）");
          if (mainScore === null || nowScore === null) console.log("両方で判定できたケースがないので、比べていません");
          else {
            const drop = mainScore - nowScore;
            const bad = drop >= RAISE_MAX_DROP - 1e-9;
            console.log(`上げる評価：main ${pct(mainScore)}（${base.from}）→ いま ${pct(nowScore)}（${drop > 0 ? `${(drop * 100).toFixed(1)}% 下がった` : `${(-drop * 100).toFixed(1)}% 上がった`}）→ ${bad ? `不合格（${pct(RAISE_MAX_DROP)} 以上下がった）` : "合格"}`);
            out.compare = { main: mainScore, now: nowScore, drop, common_cases: common?.length ?? null };
            if (bad) exit = 1;
          }
        }
      }
    }
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2));
  process.exit(exit);
}

if (/run\.ts$/.test(process.argv[1] ?? "")) main();
