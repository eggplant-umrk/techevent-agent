// 日程が決まっていない会話1件を、本物の受信箱の流れ（読み取り → 候補づくり → 空いていそうな日）で1回流す。APIを使う（見込み $0.10〜0.20）。
//   npx tsx scripts/try_date_suggest.ts
// 書き込むのは一時ファイルだけ（INBOX_FILE）。data/inbox.json・data/cards.json は触らない。架空の30人で流す（DATA_SOURCE・DEMO_PERSON は外す）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

try {
  process.loadEnvFile(".env");
} catch {
  console.error(".env がありません。APIを使うので .env の ANTHROPIC_API_KEY が必要です。");
  process.exit(1);
}
delete process.env.DATA_SOURCE;
delete process.env.DEMO_PERSON;
const tmp = path.join(os.tmpdir(), `inbox-try-date-${Date.now()}.json`);
process.env.INBOX_FILE = tmp;

const CONVERSATION = `@layerx_techpr はじめまして！フロントエンド勉強会「Front Night」運営の佐々木です🙌
12月か1月ごろに次回をやろうと思っていて、Webパフォーマンス改善の話を20分くらいしていただける方がいないかなと…
日程はまだ調整中です！会場はオフライン＋配信の予定です`;

async function main() {
  const inboxFile = path.join(process.cwd(), "data", "inbox.json");
  const cardsFile = path.join(process.cwd(), "data", "cards.json");
  const before = [inboxFile, cardsFile].map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  const { runAgent } = await import("../lib/agent");
  const { extractIntakeWithAgent } = await import("../lib/intake");
  const inbox = await import("../lib/inbox");
  const { totalUsd } = await import("../lib/usage");
  const total0 = totalUsd();
  const t0 = Date.now();
  const item = inbox.registerInbox({ text: CONVERSATION, source: "manual" });
  await inbox.prepare(item.id, (request, emit) => runAgent(request, emit), extractIntakeWithAgent, async () => ({ value: "（このテストでは作らない）", model: "none", fellBack: false }));
  const it = inbox.getInboxItem(item.id)!;
  const d = inbox.detailView(it);
  console.log(`状態：${it.status}${it.error ? `（${it.error}）` : ""}／${Math.round((Date.now() - t0) / 100) / 10}秒`);
  console.log(`読み取り：日程=${d.intake?.date ?? "未定"}／手がかり=${d.intake?.date_hint ?? "なし"}／形式=${d.intake?.format ?? "未定"}／テーマ=${d.intake?.theme ?? "未定"}／主催者=${d.intake?.organizer ?? "未定"}`);
  const ds = d.date_suggestions;
  if (ds) {
    console.log(`期間：${ds.period.from}〜${ds.period.to}（${ds.period.label}）／平日 ${ds.hours.start}〜${ds.hours.end}時`);
    for (const c of ds.candidates) console.log(`  ${c.name}：${c.dates.join("・") || "なし"}${c.note ? `（${c.note}）` : ""}\n    返事の材料：${c.reply_sentence ?? "なし"}`);
  } else console.log("空いていそうな日：なし（日程が決まっている、または候補がいない）");
  const spent = totalUsd() - total0;
  console.log(`今回 $${spent.toFixed(3)}`);
  const result = { at: new Date().toISOString(), conversation: CONVERSATION, status: it.status, intake: d.intake, candidates: d.result?.candidates.map((c) => ({ name: c.name, employee_id: c.employee_id, theme: c.theme, cautions: c.cautions })) ?? [], date_suggestions: ds, spent_usd: spent };
  fs.writeFileSync(path.join(process.cwd(), "docs", "date_suggest_result.json"), JSON.stringify(result, null, 2) + "\n");
  fs.rmSync(tmp, { force: true });
  const untouched = [inboxFile, cardsFile].every((f, i) => (before[i] ? fs.readFileSync(f).equals(before[i]!) : !fs.existsSync(f)));
  console.log(`data/inbox.json・data/cards.json：${untouched ? "変わっていない" : "変わった！"}`);
  if (!untouched) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  fs.rmSync(tmp, { force: true });
  process.exit(1);
});
