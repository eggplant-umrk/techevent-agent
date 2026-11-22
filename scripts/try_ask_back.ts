// 聞き返す項目（lib/askBack.ts）を本物の API で確かめる（API代がかかる。読み取りと主催者への返事だけで、候補づくりはしない）。
//   npx tsx scripts/try_ask_back.ts            … A1・A2・A3（scripts/fixtures/edge_cases.ts）と、?mock 用の X の会話（x2）
//   npx tsx scripts/try_ask_back.ts A2         … 1件だけ
//   npx tsx scripts/try_ask_back.ts A1 --reply-only … 読み取りは試験の一覧の偽の読み取り（raw）を使い、主催者への返事だけを本物の API で作る
// - .env は TRY_ENV_FILE（既定 .env）からこのプロセスにだけ読む。キーの値は表示しない
// - 上限（TRY_LIMIT_USD、既定 0.3）を超えそうなら、次の呼び出しの前で止める
// - x2 を流したときは、読み取った項目（足した項目つき）を app/_client/xconv.json の detail.intake に書き戻す（?mock の画面用。候補と下書きは変えない）
// - 結果は eval-results/try-ask-back.json に保存する（git の対象外）
import fs from "node:fs";
import path from "node:path";
import { EDGE_CASES } from "./fixtures/edge_cases";
import { X_CONVERSATIONS } from "./fixtures/x_conversations";

const LIMIT = Number(process.env.TRY_LIMIT_USD || "0.3");

async function main() {
  const envFile = process.env.TRY_ENV_FILE || ".env";
  if (!fs.existsSync(envFile)) {
    console.error(`${envFile} がありません（TRY_ENV_FILE で .env の場所を指定してください）`);
    process.exit(1);
  }
  process.loadEnvFile(envFile);
  for (const k of ["DATA_SOURCE", "DEMO_PERSON", "SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD"]) delete process.env[k]; // 架空データ・この端末だけで確かめる

  const { extractIntakeWithAgent, checkIntake } = await import("../lib/intake");
  const { inboxRequest } = await import("../lib/inbox");
  const { organizerReplyFacts, draftOrganizerReply } = await import("../lib/heavy");
  const { requestItems, askBack, notAsked } = await import("../lib/askBack");
  const { organizerReplyProblems } = await import("../lib/organizerReply");
  const { employees } = await import("../lib/data");
  const { runUsd } = await import("../lib/usage");

  const want = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const replyOnly = process.argv.includes("--reply-only");
  const x2 = X_CONVERSATIONS.find((c) => c.id === "x2")!;
  const cases = [
    ...EDGE_CASES.filter((c) => c.group === "聞き返し").map((c) => ({ id: c.id, title: c.title, text: c.text, received_at: "2026-11-21T10:00:00+09:00", mustNot: c.mustNotAppear ?? [], reply: true, fixtureRaw: c.raw ?? null })),
    { id: "x2", title: x2.title, text: x2.text, received_at: x2.received_at, mustNot: [] as Array<[string, RegExp]>, reply: false, fixtureRaw: null },
  ].filter((c) => !want.length || want.includes(c.id));

  const who = employees().find((e) => e.name === "百瀬 結衣")!;
  const others = employees().filter((e) => e.id !== who.id).map((e) => e.name);
  const cand = { employee_id: who.id, name: who.name, theme: "初期表示を1.8秒縮めたバンドル改善" };
  const runId = `try-askback-${Date.now()}`;
  const out: unknown[] = [];

  for (const c of cases) {
    if (runUsd(runId) + 0.05 > LIMIT) {
      console.log(`\n上限 $${LIMIT} を超えそうなので、${c.id} の前で止めます（ここまで $${runUsd(runId).toFixed(3)}）`);
      break;
    }
    console.log(`\n=== ${c.id} ${c.title}`);
    const raw = replyOnly && c.fixtureRaw ? c.fixtureRaw : await extractIntakeWithAgent(c.text, runId);
    if (!raw || typeof raw === "string") {
      console.log("読み取れませんでした");
      continue;
    }
    const read = checkIntake(c.text, raw, c.received_at);
    const request = inboxRequest({ id: `inb-try-${c.id}`, text: c.text, received_at: c.received_at, source: "manual", nominee: read.nominee, intake: read.intake });
    const items = requestItems(request);
    console.log("# 項目（コードで確かめたあと）");
    for (const i of items) console.log(`  ${i.label}：${i.value ?? "未定"}`);
    const reasons = Object.entries(read.intake.extra_reasons ?? {}).filter(([, why]) => !why.includes("書かれていません"));
    if (reasons.length) console.log(`# 確かめられず未定にした項目：${reasons.map(([f, why]) => `${f}（${why}）`).join("／")}`);
    const ask = askBack(items);
    console.log(`# 主催者に聞く項目（コードが選ぶ）：${ask.map((i) => i.label).join("・") || "なし"}`);

    let reply: { reply: string; note: string | null; model: string; cost_usd: number } | null = null;
    let problems: string[] = [];
    if (c.reply) {
      const facts = organizerReplyFacts(request, cand);
      reply = await draftOrganizerReply(runId, request, cand);
      problems = organizerReplyProblems(reply.reply, who.name, others, { conversation: request.message, facts, ask: ask.map((i) => i.key), skip: notAsked(items).map((i) => i.key) });
      const leaked = c.mustNot.filter(([, re]) => re.test(reply!.reply) || re.test(facts)).map(([what]) => what);
      console.log(`# 主催者への返事（${who.name}で進める場合、${reply.model}、${reply.reply.length}字）`);
      console.log(reply.reply);
      if (reply.note) console.log(`（${reply.note}）`);
      console.log(`検査：${problems.length ? problems.join(" / ") : "問題なし"}${leaked.length ? `／出てはいけないもの：${leaked.join("・")}` : ""}`);
    }
    out.push({ id: c.id, raw, intake: read.intake, items, ask: ask.map((i) => i.label), reply: reply?.reply ?? null, reply_note: reply?.note ?? null, problems });

    if (c.id === "x2") {
      const file = path.join(process.cwd(), "app", "_client", "xconv.json");
      const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { detail: { intake: Record<string, unknown> | null } };
      const before = saved.detail.intake ?? {};
      const same = (["event_name", "date", "format", "theme", "organizer"] as const).every((f) => (before[f] ?? null) === (read.intake[f] ?? null));
      if (same && read.intake.extra) {
        saved.detail.intake = { ...before, extra: read.intake.extra, extra_reasons: read.intake.extra_reasons ?? {} };
        fs.writeFileSync(file, JSON.stringify(saved, null, 2) + "\n");
        console.log("保存：app/_client/xconv.json の読み取った項目に、足した項目を書き足しました（候補と下書きはそのまま）");
      } else {
        console.log("今までの5項目の読み取りが保存分と違うため、app/_client/xconv.json は書き換えていません");
      }
    }
  }

  const total = runUsd(runId);
  console.log(`\n今回の合計：$${total.toFixed(3)}`);
  const file = path.join(process.cwd(), "eval-results", "try-ask-back.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), run_usd: total, cases: out }, null, 2) + "\n");
  console.log(`保存：${path.relative(process.cwd(), file)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
