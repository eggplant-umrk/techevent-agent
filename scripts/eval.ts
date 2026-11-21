// Evaluation: run the agent on data/requests.json and compare the top 3 with the
// expected candidates in data/README.md. Only this script reads README.md; the
// agent never sees it.
//
//   npm run eval -- req004        # one request
//   npm run eval -- all           # all five
//
// Uses API credits. The key is read from .env into this process only.
import fs from "node:fs";
import path from "node:path";
import { runAgent, type AgentEvent, type ProposalResult } from "../lib/agent";
import { employees, requests } from "../lib/data";
import { totalUsd } from "../lib/usage";

process.loadEnvFile(".env");

interface Expected {
  ids: string[];
  primary: string | undefined;
}

/** Parse "### 依頼ごとの想定候補" in data/README.md. Excludes the nominee and the five most frequent speakers. */
function loadExpected(): Record<string, Expected> {
  const md = fs.readFileSync(path.join(process.cwd(), "data", "README.md"), "utf-8");
  const section = md.split("### 依頼ごとの想定候補")[1]?.split(/\n#{2,3} |\n---/)[0] ?? "";
  const top5 = new Set(
    employees()
      .slice()
      .sort((a, b) => b.past_talk_count - a.past_talk_count)
      .slice(0, 5)
      .map((e) => e.id),
  );
  const reqs = new Map(requests().map((r) => [r.id, r]));
  const out: Record<string, Expected> = {};
  for (const line of section.split("\n")) {
    const m = line.match(/^\|\s*(req\d{3})[^|]*\|(.*)\|\s*$/);
    if (!m) continue;
    const nominee = reqs.get(m[1])?.nominated_employee_id;
    const ids = [...new Set(m[2].match(/e\d{3}/g) ?? [])].filter((id) => id !== nominee && !top5.has(id));
    out[m[1]] = { ids, primary: ids[0] };
  }
  return out;
}

function short(e: AgentEvent): string | null {
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

async function main() {
  const arg = process.argv[2] ?? "";
  const all = requests();
  const targets = arg === "all" ? all : all.filter((r) => arg.split(",").includes(r.id));
  if (targets.length === 0) {
    console.error("使い方: npm run eval -- req001 | req001,req004 | all");
    process.exit(1);
  }
  const expected = loadExpected();
  const names = new Map(employees().map((e) => [e.id, e.name]));
  const rows: Array<Record<string, unknown>> = [];
  const startTotal = totalUsd();

  for (const r of targets) {
    console.log(`\n=== ${r.id} (${r.pattern}) ${r.event?.title}`);
    let runUsd = 0;
    let steps = 0;
    const result: ProposalResult | null = await runAgent(r, (e) => {
      const s = short(e);
      if (s) console.log(s);
      if (e.type === "done") {
        runUsd = e.run_usd;
        steps = e.steps;
      }
    });
    const top3 = result?.candidates.map((c) => c.employee_id) ?? [];
    const exp = expected[r.id] ?? { ids: [], primary: undefined };
    const anyHit = exp.ids.some((id) => top3.includes(id));
    const primaryHit = exp.primary ? top3.includes(exp.primary) : false;
    const alt = result?.candidates.filter((c) => c.is_alternative_to_nominee).map((c) => c.employee_id) ?? [];
    const altOk = r.nominated_employee_id ? alt.some((id) => exp.ids.includes(id)) : null;
    console.log(`  top3: ${top3.map((id) => `${id} ${names.get(id)}`).join(" / ") || "(なし)"}`);
    console.log(`  想定: ${exp.ids.join(", ")}（主: ${exp.primary}）`);
    console.log(`  判定: 想定のいずれか=${anyHit ? "○" : "×"} 主候補=${primaryHit ? "○" : "×"}${altOk === null ? "" : ` 代わりの提案=${altOk ? "○" : "×"}`}`);
    console.log(`  コスト: $${runUsd.toFixed(3)}（モデル呼び出し${steps}回）`);
    rows.push({
      request_id: r.id,
      pattern: r.pattern,
      top3,
      expected: exp.ids,
      primary: exp.primary,
      any_hit: anyHit,
      primary_hit: primaryHit,
      alternatives: alt,
      alternative_ok: altOk,
      run_usd: runUsd,
      steps,
      result,
    });
  }

  const spent = totalUsd() - startTotal;
  console.log(`\n=== まとめ`);
  for (const row of rows) {
    console.log(
      `${row.request_id}  想定のいずれか ${row.any_hit ? "○" : "×"}  主候補 ${row.primary_hit ? "○" : "×"}` +
        `${row.alternative_ok === null ? "" : `  代わりの提案 ${row.alternative_ok ? "○" : "×"}`}  $${(row.run_usd as number).toFixed(3)}`,
    );
  }
  console.log(`今回の評価で使った金額: $${spent.toFixed(3)}／累計: $${totalUsd().toFixed(3)}`);

  const dir = path.join(process.cwd(), "eval-results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), spent_usd: spent, rows }, null, 2));
  console.log(`結果: ${path.relative(process.cwd(), file)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
