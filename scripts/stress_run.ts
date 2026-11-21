// 汚れた10倍のデータ（data/sources/stress/）で「ネタ帳を更新」を本番で流し、耐えられるかを確かめる。APIを使う。
//   npx tsx scripts/stress_run.ts e013            1人だけ（試すとき）
//   npx tsx scripts/stress_run.ts e013,e015,e024  3人
//   npx tsx scripts/stress_run.ts --judge-only    いまの stress のカードを判定するだけ（APIなし）
// 判定：①ノイズ（途中で終わる話・雑談・無関係）からカードを作っていないか ②正解の取り組みを拾えたか ③重複したカードを作っていないか。時間と金額も記録する。
// 正解は data/sources/stress/README.md の JSON（Agent には渡さない。ここだけが読む）。
// 架空の30人のネタ帳（data/cards.json）には触らない。stress のカードと状態は、記録したあと最初の空の状態に戻す。
import fs from "node:fs";
import path from "node:path";

process.env.DATA_SOURCE = "stress"; // 架空の30人のカードではなく data/sources/stress/ を使う
const judgeOnly = process.argv.includes("--judge-only");
if (!judgeOnly) {
  try {
    process.loadEnvFile(".env");
  } catch {
    console.error(".env がありません。APIを使うので .env の ANTHROPIC_API_KEY が必要です。");
    process.exit(1);
  }
  process.env.DATA_SOURCE = "stress"; // .env の DATA_SOURCE より優先
}

import { loadCards, type Card } from "../lib/cards";
import { activities } from "../lib/data";
import { updateNotebook, type NotebookEvent } from "../lib/notebook";
import { totalUsd } from "../lib/usage";

const DIR = path.join(process.cwd(), "data", "sources", "stress");
const RESULT = path.join(process.cwd(), "docs", "stress_result.json");
const FICTIONAL_CARDS = path.join(process.cwd(), "data", "cards.json");

interface Answer {
  name: string;
  topic: string;
  signal: string[];
  duplicate: string[];
  truncated: string[];
  chat: string[];
  unrelated: string[];
}
function loadAnswer(): Record<string, Answer> {
  const md = fs.readFileSync(path.join(DIR, "README.md"), "utf-8");
  return JSON.parse(md.match(/```json\n([\s\S]*?)\n```/)![1]);
}

/** 1人分のカードを判定する */
export function judge(eid: string, cards: Card[], ans: Answer) {
  const own = cards.filter((c) => c.employee_id === eid);
  const topicIds = new Set([...ans.signal, ...ans.duplicate]);
  const noiseIds = new Set([...ans.truncated, ...ans.chat, ...ans.unrelated]);
  const rows = own.map((c) => {
    const ev = c.evidence_activity_ids;
    const onTopic = ev.filter((id) => topicIds.has(id)).length;
    const onNoise = ev.filter((id) => noiseIds.has(id));
    const kind = onTopic > 0 ? "topic" : onNoise.length > 0 ? "noise" : "unknown";
    return {
      card_id: c.card_id,
      theme: c.themes[0],
      evidence: ev.length,
      on_topic: onTopic,
      noise_evidence: onNoise.map((id) => (ans.truncated.includes(id) ? `${id}（途中で終わる話）` : ans.chat.includes(id) ? `${id}（雑談）` : `${id}（無関係）`)),
      kind,
    };
  });
  const topicCards = rows.filter((r) => r.kind === "topic");
  const signalCovered = new Set(own.flatMap((c) => c.evidence_activity_ids).filter((id) => ans.signal.includes(id))).size;
  return {
    employee_id: eid,
    name: ans.name,
    cards: rows,
    noise_cards: rows.filter((r) => r.kind !== "topic").length,
    noise_in_evidence: rows.reduce((n, r) => n + r.noise_evidence.length, 0),
    found_topic: topicCards.length > 0,
    duplicate_topic_cards: Math.max(0, topicCards.length - 1),
    signal_covered: `${signalCovered}/${ans.signal.length}`,
  };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const answer = loadAnswer();
  const targets = (args[0] ?? "").split(",").filter(Boolean);
  if (!judgeOnly && (!targets.length || targets.some((t) => !answer[t]))) {
    console.error(`使い方: npx tsx scripts/stress_run.ts e013,e015,e024 | --judge-only（対象：${Object.keys(answer).join(", ")}）`);
    process.exit(1);
  }
  const fictionalBefore = fs.readFileSync(FICTIONAL_CARDS);
  const cardsFile = path.join(DIR, "cards.json");
  const stateFile = path.join(DIR, "notebook_state.json");
  const cardsBefore = fs.readFileSync(cardsFile);
  const stateBefore = fs.readFileSync(stateFile);

  const per: Array<Record<string, unknown>> = [];
  if (!judgeOnly) {
    const total0 = totalUsd();
    for (const eid of targets) {
      const acts = activities().filter((a) => a.author_id === eid);
      const chars = acts.reduce((n, a) => n + a.title.length + a.body.length, 0);
      const log: string[] = [];
      let usd = 0;
      const t0 = Date.now();
      await updateNotebook([eid], (e: NotebookEvent) => {
        if (e.type === "card") log.push(e.message);
        if (e.type === "rejected") log.push(`差し戻し：${e.errors.join(" / ")}`);
        if (e.type === "no_card") log.push(`カードなし：${e.note}`);
        if (e.type === "error") log.push(`エラー：${e.message}`);
        if (e.type === "done") usd = e.run_usd;
      });
      const seconds = Math.round((Date.now() - t0) / 100) / 10;
      const j = judge(eid, loadCards(), answer[eid]);
      per.push({ ...j, activities: acts.length, activity_chars: chars, seconds, usd, log });
      console.log(`\n=== ${eid} ${answer[eid].name}（活動${acts.length}件・${chars}字）${seconds}秒・$${usd.toFixed(3)}`);
      for (const l of log) console.log(`  ${l}`);
      for (const r of j.cards) console.log(`  [${r.kind}] ${r.card_id}「${r.theme}」根拠${r.evidence}件（取り組み${r.on_topic}件${r.noise_evidence.length ? `、ノイズ ${r.noise_evidence.join("・")}` : ""}）`);
      console.log(`  ①ノイズのカード ${j.noise_cards}枚 ②取り組みを拾えた ${j.found_topic ? "はい" : "いいえ"}（取り組みの投稿 ${j.signal_covered} を根拠に）③重複したカード ${j.duplicate_topic_cards}枚`);
    }
    const spent = totalUsd() - total0;
    const prev = fs.existsSync(RESULT) ? JSON.parse(fs.readFileSync(RESULT, "utf-8")) : { runs: [] };
    prev.runs.push({ at: new Date().toISOString(), targets, spent_usd: spent, per, cards: loadCards() });
    fs.writeFileSync(RESULT, JSON.stringify(prev, null, 2) + "\n");
    console.log(`\n今回 $${spent.toFixed(3)}／保存：docs/stress_result.json`);
    // stress のカードと状態を最初の状態に戻す（何度でも同じ条件で測れるように）
    fs.writeFileSync(cardsFile, cardsBefore);
    fs.writeFileSync(stateFile, stateBefore);
  } else {
    for (const eid of Object.keys(answer)) console.log(JSON.stringify(judge(eid, loadCards(), answer[eid])));
  }
  const untouched = fs.readFileSync(FICTIONAL_CARDS).equals(fictionalBefore);
  console.log(`架空の30人のネタ帳（data/cards.json）：${untouched ? "変わっていない" : "変わった！"}`);
  if (!untouched) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
