// 主催者への返事まわりの直しを、本物の API で2件だけ確かめる（API代がかかる。上限 TRY_LIMIT_USD、既定 0.3）。
//   TRY_ENV_FILE=<.env の場所> npx tsx scripts/try_reply_fix.ts
// 流すのは主催者への返事だけ（軽いモデル）。候補づくり・声かけ文は流さない。
//   1件目：テーマ案に「負荷」が入る候補（前は、テーマ案の言葉だけで決まった文に差し替えになっていた）
//   2件目：X の会話から読み取った依頼（試験の一覧の N1）で、ふつうの候補
// あわせて、社内の情報の形が入ったテーマ案では API を呼ばないこと（$0）も見る。
// .env はこのプロセスにだけ読む。キーの値は表示しない。受信箱・カードには書かない。結果は docs/reply_fix_result.json
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EDGE_CASES } from "./fixtures/edge_cases";

const LIMIT = Number(process.env.TRY_LIMIT_USD || "0.3");

async function main() {
  const envFile = process.env.TRY_ENV_FILE || ".env";
  if (!fs.existsSync(envFile)) {
    console.error(`${envFile} がありません（TRY_ENV_FILE で場所を指定）`);
    process.exit(1);
  }
  process.loadEnvFile(envFile);
  for (const k of ["DATA_SOURCE", "DEMO_PERSON", "SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD"]) delete process.env[k];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "try-reply-fix-"));
  process.env.DATA_RUNTIME_DIR = path.join(tmp, "runtime");
  process.env.INBOX_FILE = path.join(tmp, "inbox.json");
  process.env.FIXED_TODAY ??= "2026-11-21";

  const H = await import("../lib/heavy");
  const R = await import("../lib/organizerReply");
  const { employees, requests } = await import("../lib/data");
  const { checkIntake } = await import("../lib/intake");
  const { inboxRequest } = await import("../lib/inbox");
  const { totalUsd } = await import("../lib/usage");
  const all = employees();
  const t0 = totalUsd();
  const spent = () => totalUsd() - t0;
  const rows: unknown[] = [];
  try {
    const n1 = EDGE_CASES.find((c) => c.id === "N1")!;
    const read = checkIntake(n1.text, n1.raw!, "2026-11-21T10:00:00+09:00");
    const cases = [
      { label: "テーマ案に「負荷」が入る候補（サンプルの依頼 req003）", request: requests().find((r) => r.id === "req003")!, employee: "鳴海 慎", theme: "対応不要アラートを半減させるまで：オンコール負荷を見える化するダッシュボードの作り方" },
      { label: "X の会話から読み取った依頼（N1）", request: inboxRequest({ id: "inb-try", text: n1.text, received_at: "2026-11-21T10:00:00+09:00", source: "manual", nominee: read.nominee, intake: read.intake }), employee: "芹沢 葵", theme: "夜間バッチの失敗を自動で切り分ける仕組みと、障害対応の振り返りの進め方" },
    ];
    for (const c of cases) {
      if (spent() + 0.1 > LIMIT) {
        rows.push({ label: c.label, skipped: `上限 $${LIMIT} を超えそうなので流していない` });
        continue;
      }
      const emp = all.find((e) => e.name === c.employee)!;
      const others = all.filter((e) => e.id !== emp.id).map((e) => e.name);
      const before = spent();
      const r = await H.draftOrganizerReply("try-reply-fix", c.request, { employee_id: emp.id, name: emp.name, theme: c.theme });
      const facts = H.organizerReplyFacts(c.request, { name: emp.name, theme: c.theme });
      const problems = R.organizerReplyProblems(r.reply, emp.name, others, { conversation: c.request.message, facts });
      rows.push({ label: c.label, employee: emp.name, theme: c.theme, reply: r.reply, replaced: !!r.note, note: r.note, model: r.model, final_check: problems, has_theme: r.reply.includes(c.theme.slice(0, 12)), usd: Number((spent() - before).toFixed(4)) });
      console.log(`# ${c.label}\n${r.reply}\n  差し替え：${r.note ? `あり（${r.note}）` : "なし"}／最後の検査：${problems.length ? problems.join(" / ") : "問題なし"}／$${(spent() - before).toFixed(4)}`);
    }
    // 社内の情報の形が入ったテーマ案：API を呼ばない
    const emp = all.find((e) => e.name === "鳴海 慎")!;
    const before = spent();
    const blocked = await H.draftOrganizerReply("try-reply-fix", requests().find((r) => r.id === "req003")!, { employee_id: emp.id, name: emp.name, theme: "オンコール改善（過去4回の実績）" });
    rows.push({ label: "社内の情報の形が入ったテーマ案", reply: blocked.reply, note: blocked.note, usd: Number((spent() - before).toFixed(4)) });
    console.log(`# 社内の情報の形が入ったテーマ案\n${blocked.reply}\n  ${blocked.note}／$${(spent() - before).toFixed(4)}`);
    fs.writeFileSync(path.join(process.cwd(), "docs", "reply_fix_result.json"), JSON.stringify({ at: new Date().toISOString(), limit_usd: LIMIT, spent_usd: Number(spent().toFixed(4)), rows }, null, 2) + "\n");
    console.log(`\n今回 $${spent().toFixed(4)}（上限 $${LIMIT}）／保存：docs/reply_fix_result.json`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
