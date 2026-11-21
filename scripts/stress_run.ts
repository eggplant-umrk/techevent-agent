// 「ネタ帳を更新」を本番で流し、耐えられるかを確かめる。APIを使う。
//   npx tsx scripts/stress_run.ts e013            汚れた10倍のデータ（data/sources/stress/）で1人だけ（試すとき）
//   npx tsx scripts/stress_run.ts e013,e015,e024  同じく3人
//   npx tsx scripts/stress_run.ts --demo          デモ用の本人（e031・本物の GitHub の活動）を、カードが空の状態から1回
//   npx tsx scripts/stress_run.ts --judge-only    いまの stress のカードを判定するだけ（APIなし）
// 判定（stress）：①ノイズ（途中で終わる話・雑談・無関係）からカードを作っていないか ②正解の取り組みを拾えたか ③重複したカードを作っていないか。
// 時間と金額、流す前の見積もり、コードで落とした件数と理由、次回に回した件数も記録する。
// 正解は data/sources/stress/README.md の JSON（Agent には渡さない。ここだけが読む）。
// 1回目のあと、新しい活動が残っていなければもう一度流して、API を呼ばずに終わる（差分だけ読む）ことも確かめる。
// 架空の30人のネタ帳（data/cards.json）には触らない。stress・本人のカードと状態は、記録したあと元の状態に戻す。
import fs from "node:fs";
import path from "node:path";

const judgeOnly = process.argv.includes("--judge-only");
const demo = process.argv.includes("--demo");
function useSource() {
  if (demo) {
    delete process.env.DATA_SOURCE;
    process.env.DEMO_PERSON = "on";
  } else {
    process.env.DATA_SOURCE = "stress"; // 架空の30人のカードではなく data/sources/stress/ を使う
  }
}
useSource();
if (!judgeOnly) {
  try {
    process.loadEnvFile(".env");
  } catch {
    console.error(".env がありません。APIを使うので .env の ANTHROPIC_API_KEY が必要です。");
    process.exit(1);
  }
  useSource(); // .env の DATA_SOURCE・DEMO_PERSON より優先
}

import { loadCards, type Card } from "../lib/cards";
import { activities } from "../lib/data";
import { DEMO_ID } from "../lib/demoPerson";
import { updateNotebook, type NotebookEvent } from "../lib/notebook";
import { prepareEmployee } from "../lib/notebookPrep";
import { totalUsd } from "../lib/usage";

const DIR = path.join(process.cwd(), "data", "sources", demo ? "demo-person" : "stress");
const RESULT = path.join(process.cwd(), "docs", demo ? "notebook_demo_result.json" : "stress_result.json");
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
  const md = fs.readFileSync(path.join(process.cwd(), "data", "sources", "stress", "README.md"), "utf-8");
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

/** 1回流して、見積もり・前処理・カード・金額・時間を記録する */
async function runOnce(eid: string) {
  const log: string[] = [];
  let usd = 0;
  let estimate = 0;
  let prep: Record<string, unknown> | null = null;
  let calledApi = false;
  const t0 = Date.now();
  await updateNotebook([eid], (e: NotebookEvent) => {
    if (e.type === "budget") {
      estimate = e.estimate_usd;
      log.push(e.message);
    }
    if (e.type === "prep") {
      prep = { fresh: e.fresh, sent: e.sent, dropped: e.dropped, deferred: e.deferred };
      log.push(e.message);
    }
    if (e.type === "usage") calledApi = true;
    if (e.type === "card") log.push(e.message);
    if (e.type === "rejected") log.push(`差し戻し：${e.errors.join(" / ")}`);
    if (e.type === "no_card") log.push(`カードなし：${e.note}`);
    if (e.type === "error") log.push(`エラー：${e.message}`);
    if (e.type === "done") usd = e.run_usd;
  });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  return { log, usd, estimate, prep, calledApi, seconds };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const answer = loadAnswer();
  const targets = demo ? [DEMO_ID] : (args[0] ?? "").split(",").filter(Boolean);
  if (!judgeOnly && !demo && (!targets.length || targets.some((t) => !answer[t]))) {
    console.error(`使い方: npx tsx scripts/stress_run.ts e013,e015,e024 | --demo | --judge-only（対象：${Object.keys(answer).join(", ")}）`);
    process.exit(1);
  }
  const fictionalBefore = fs.readFileSync(FICTIONAL_CARDS);
  const files = ["cards.json", "notebook_state.json", "notebook_progress.json"].map((n) => path.join(DIR, n));
  const before = files.map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));
  const restore = () => files.forEach((f, i) => (before[i] ? fs.writeFileSync(f, before[i]!) : fs.rmSync(f, { force: true })));

  const per: Array<Record<string, unknown>> = [];
  if (!judgeOnly) {
    const previousCards = demo ? (JSON.parse(before[0]!.toString("utf-8")) as Card[]) : [];
    if (demo) {
      // 本人のカードが空の状態から流す（①が全履歴を読んで作った8枚と比べるため）。終わったら元に戻す
      fs.writeFileSync(files[0], "[]\n");
      fs.writeFileSync(files[1], "{}\n");
      fs.rmSync(files[2], { force: true });
    }
    try {
      const total0 = totalUsd();
      for (const eid of targets) {
        const acts = activities().filter((a) => a.author_id === eid);
        const chars = acts.reduce((n, a) => n + a.title.length + a.body.length, 0);
        const r = await runOnce(eid);
        const cards = loadCards().filter((c) => c.employee_id === eid);
        const j = demo
          ? { employee_id: eid, cards: cards.map((c) => ({ card_id: c.card_id, theme: c.themes[0], evidence: c.evidence_activity_ids.length })) }
          : judge(eid, loadCards(), answer[eid]);
        // 2回目：新しい活動が残っていなければ、API を呼ばずに終わるはず
        const left = prepareEmployee(eid, activities(), JSON.parse(fs.readFileSync(files[1], "utf-8"))[eid]).fresh;
        const second = left === 0 ? await runOnce(eid) : null;
        per.push({ ...j, activities: acts.length, activity_chars: chars, seconds: r.seconds, usd: r.usd, estimate_usd: r.estimate, prep: r.prep, log: r.log, left_for_next: left, second_run: second && { usd: second.usd, called_api: second.calledApi, log: second.log } });
        console.log(`\n=== ${eid} ${demo ? "本人" : answer[eid].name}（活動${acts.length}件・${chars}字）${r.seconds}秒・$${r.usd.toFixed(3)}（見積もり $${r.estimate.toFixed(3)}）`);
        for (const l of r.log) console.log(`  ${l}`);
        if ("noise_cards" in j) {
          for (const c of j.cards) console.log(`  [${c.kind}] ${c.card_id}「${c.theme}」根拠${c.evidence}件（取り組み${c.on_topic}件${c.noise_evidence.length ? `、ノイズ ${c.noise_evidence.join("・")}` : ""}）`);
          console.log(`  ①ノイズのカード ${j.noise_cards}枚 ②取り組みを拾えた ${j.found_topic ? "はい" : "いいえ"}（取り組みの投稿 ${j.signal_covered} を根拠に）③重複したカード ${j.duplicate_topic_cards}枚`);
        } else {
          for (const c of j.cards) console.log(`  ${c.card_id}「${c.theme}」根拠${c.evidence}件`);
          console.log(`  前回（全履歴を読んだ①の8枚）：\n${previousCards.map((c) => `    ${c.card_id}「${c.themes[0]}」根拠${c.evidence_activity_ids.length}件`).join("\n")}`);
        }
        console.log(left ? `  次回に回した活動：${left}件（次の更新で読む）` : `  2回目：$${second!.usd.toFixed(3)}・API ${second!.calledApi ? "を呼んだ" : "は呼ばなかった"}`);
      }
      const spent = totalUsd() - total0;
      const prev = fs.existsSync(RESULT) ? JSON.parse(fs.readFileSync(RESULT, "utf-8")) : { runs: [] };
      prev.runs.push({ at: new Date().toISOString(), targets, spent_usd: spent, per, cards: loadCards().filter((c) => targets.includes(c.employee_id)) });
      fs.writeFileSync(RESULT, JSON.stringify(prev, null, 2) + "\n");
      console.log(`\n今回 $${spent.toFixed(3)}／保存：${path.relative(process.cwd(), RESULT)}`);
    } finally {
      // カードと状態を元に戻す（何度でも同じ条件で測れるように）
      restore();
    }
  } else {
    for (const eid of Object.keys(answer)) console.log(JSON.stringify(judge(eid, loadCards(), answer[eid])));
  }
  const untouched = fs.readFileSync(FICTIONAL_CARDS).equals(fictionalBefore);
  const restored = files.every((f, i) => (before[i] ? fs.existsSync(f) && fs.readFileSync(f).equals(before[i]!) : !fs.existsSync(f)));
  console.log(`架空の30人のネタ帳（data/cards.json）：${untouched ? "変わっていない" : "変わった！"}／${path.relative(process.cwd(), DIR)} のカードと状態：${restored ? "元に戻した" : "戻っていない！"}`);
  if (!untouched || !restored) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
