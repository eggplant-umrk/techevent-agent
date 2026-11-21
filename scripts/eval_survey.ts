// 結合テストのうち、イベント後のアンケートの判定（v0.4）。scripts/eval.ts から呼ぶ。
// - APIを使わない判定（--offline でも流す）：保存済みの分析結果（docs/survey_latest.json）を今の検証で判定し直す
//     根拠の回答idが実在／画面の数字がコードの計算と一致／使う人向けの文に内部の言葉がない／確認済みカードを上書きしない
// - APIを使う判定：アンケート分析 → 書き戻し（提案は採用した状態にする）→ 次の提案が変わる
// data/cards.json は判定のたびにバイトごと元に戻す。
import fs from "node:fs";
import path from "node:path";
import type { ProposalResult } from "../lib/agent";
import { loadCards, patchCard } from "../lib/cards";
import { events, surveys, type SpeakingRequest } from "../lib/data";
import { analyzeEvent, eventDetail, talkStats, validateAnalysis, writeBack, type EventAnalysis } from "../lib/surveys";

export interface SurveyCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export const SURVEY_EVENT = "ev019";
export const SURVEY_REQUEST = "req002";
const SAVED = path.join(process.cwd(), "docs", "survey_latest.json");
const CARDS = path.join(process.cwd(), "data", "cards.json");

export function loadSavedAnalyses(): { at: string; analyses: Record<string, EventAnalysis> } | null {
  if (!fs.existsSync(SAVED)) return null;
  return JSON.parse(fs.readFileSync(SAVED, "utf-8"));
}

/** cards.json を元に戻す約束つきで fn を実行する */
export async function withCardsRestored<T>(fn: () => Promise<T> | T): Promise<T> {
  const original = fs.readFileSync(CARDS);
  try {
    return await fn();
  } finally {
    fs.writeFileSync(CARDS, original);
  }
}

/** APIを使わない判定。保存済みの分析結果がなければ空（数に入れない） */
export async function surveyCodeChecks(): Promise<SurveyCheck[]> {
  const saved = loadSavedAnalyses();
  if (!saved || !Object.keys(saved.analyses).length) {
    console.log("\n（アンケート：保存済みの分析結果 docs/survey_latest.json がないため省略。npx tsx scripts/analyze_surveys.ts で作る）");
    return [];
  }
  const checks: SurveyCheck[] = [];
  const all = surveys();
  const list = Object.values(saved.analyses);

  // 根拠の回答id・内部の言葉・数字の書き込み（validateAnalysis が全部見る）
  const problems = list.flatMap((a) => validateAnalysis(a.event_id, { talks: a.talks }, all).map((e) => `${a.event_id} ${e}`));
  const idProblems = problems.filter((e) => /回答|カード/.test(e));
  const plainProblems = problems.filter((e) => /内部|数字/.test(e));
  const ids = list.flatMap((a) => a.talks.flatMap((t) => [...t.hits, ...t.stumbles, ...t.next_themes].flatMap((p) => p.response_ids)));
  checks.push({ name: "アンケート：根拠の回答idが実在（その登壇への回答）", pass: idProblems.length === 0, detail: idProblems.join(" / ") || `${list.length}イベント・${ids.length}件すべて実在` });
  checks.push({ name: "アンケート：使う人向けの文に内部の言葉・数字がない", pass: plainProblems.length === 0, detail: plainProblems.join(" / ") || "なし" });

  // 画面に出す数字（保存した数字・画面の窓口が返す数字）がコードの計算と一致
  const mismatch: string[] = [];
  for (const a of list) {
    const now = talkStats(a.event_id, all);
    const screen = eventDetail(a.event_id)?.talks.map((t) => t.stats).filter(Boolean) ?? [];
    for (const t of a.talks) {
      const want = now.find((s) => s.speaker_id === t.speaker_id);
      const rows = all.filter((s) => s.event_id === a.event_id && s.talk_speaker_id === t.speaker_id);
      const avg = Math.round((rows.reduce((x, r) => x + r.rating, 0) / rows.length) * 10) / 10;
      if (!want || JSON.stringify(want) !== JSON.stringify(t.stats)) mismatch.push(`${a.event_id} ${t.speaker_id} 保存した数字`);
      if (!want || want.count !== rows.length || want.average !== avg) mismatch.push(`${a.event_id} ${t.speaker_id} 計算`);
      if (!screen.some((s) => JSON.stringify(s) === JSON.stringify(want))) mismatch.push(`${a.event_id} ${t.speaker_id} 画面`);
    }
  }
  checks.push({ name: "アンケート：画面の数字がコードの計算と一致", pass: mismatch.length === 0, detail: mismatch.join(" / ") || `${list.reduce((n, a) => n + a.talks.length, 0)}登壇の件数・平均・分布が一致` });

  // 確認済みカードを上書きしない（書き戻しはコードなので、保存済みの分析で確かめられる）
  const overwritten: string[] = [];
  await withCardsRestored(() => {
    const speakers = [...new Set(list.flatMap((a) => a.talks.map((t) => t.speaker_id)))];
    const targets = loadCards().filter((c) => speakers.includes(c.employee_id) || list.some((a) => a.talks.some((t) => t.next_themes.some((n) => n.overlaps_card_id === c.card_id))));
    for (const c of targets) patchCard(c.card_id, (x) => ({ ...x, reviewed: true, reviewed_at: "2026-11-20T00:00:00Z" }));
    const before = new Map(loadCards().map((c) => [c.card_id, c]));
    for (const a of list) {
      const ev = events().find((e) => e.id === a.event_id)!;
      writeBack(ev, a.talks);
    }
    for (const c of loadCards()) {
      const b = before.get(c.card_id);
      if (!b?.reviewed) continue;
      if (c.summary !== b.summary || JSON.stringify(c.themes) !== JSON.stringify(b.themes) || c.format !== b.format || c.format_reason !== b.format_reason)
        overwritten.push(`${c.card_id} の内容が変わった`);
      if ((c.reactions ?? []).some((r) => r.status === "adopted" && !(b.reactions ?? []).some((x) => x.id === r.id))) overwritten.push(`${c.card_id} に提案なしで反応が入った`);
    }
  });
  checks.push({ name: "アンケート：確認済みカードを上書きしない（反応は提案にとどめる）", pass: overwritten.length === 0, detail: overwritten.join(" / ") || "要約・テーマ案・おすすめの形は変わらず、反応は提案" });
  return checks;
}

const REACTION_WORDS = /アンケート|参加者|聞きたい|需要/;
const textOf = (p: ProposalResult | null | undefined) =>
  [...(p?.learnings_applied ?? []), ...(p?.candidates ?? []).flatMap((c) => [c.reason, c.caveat ?? "", ...c.cautions])].join("\n");

/**
 * APIを使う判定：アンケート分析 → 書き戻し → 次の提案が変わる。
 * before は書き戻し前の提案（同じ実行の結果があれば使い回す）。書き戻した提案は技術広報が採用した状態にしてから提案し直す。
 */
export async function surveyLiveCheck(
  req: SpeakingRequest,
  before: ProposalResult | null,
  propose: (r: SpeakingRequest) => Promise<{ result: ProposalResult | null; usd: number }>,
): Promise<{ check: SurveyCheck; record: Record<string, unknown> }> {
  return withCardsRestored(async () => {
    console.log(`\n=== アンケートの書き戻しテスト：${SURVEY_EVENT} を分析して書き戻し、${req.id} をもう一度`);
    const b = before ?? (await propose(req)).result;
    const log: string[] = [];
    const analysis = await analyzeEvent(SURVEY_EVENT, (e) => {
      if (e.type === "writeback") log.push(e.message);
      if (e.type === "rejected") log.push(`差し戻し：${e.errors.join(" / ")}`);
      if (e.type === "error") log.push(`エラー：${e.message}`);
    });
    if (!analysis) return { check: { name: "アンケート分析 → 書き戻し → 次の提案が変わる", pass: false, detail: `分析できなかった：${log.join(" / ")}` }, record: { log } };
    // 技術広報が提案を採用した状態にする
    for (const c of loadCards()) {
      if ((c.reactions ?? []).some((r) => r.status === "pending" && r.event_id === SURVEY_EVENT))
        patchCard(c.card_id, (x) => ({ ...x, reactions: (x.reactions ?? []).map((r) => (r.event_id === SURVEY_EVENT ? { ...r, status: "adopted" } : r)) }));
    }
    const withReaction = new Set(loadCards().filter((c) => (c.reactions ?? []).some((r) => r.status === "adopted")).map((c) => c.card_id));
    const again = await propose(req);
    const a = again.result;
    const beforeText = textOf(b);
    const afterUsed = (a?.candidates ?? []).filter((c) => c.card_id && withReaction.has(c.card_id) && REACTION_WORDS.test(`${c.reason}\n${c.caveat ?? ""}\n${c.cautions.join("\n")}`));
    const afterLearn = (a?.learnings_applied ?? []).some((t) => REACTION_WORDS.test(t));
    const changed = (afterUsed.length > 0 || afterLearn) && !REACTION_WORDS.test(beforeText);
    const top = (p: ProposalResult | null | undefined) => (p?.candidates ?? []).map((c) => c.employee_id).join(",");
    const detail = `前 ${top(b)} → 後 ${top(a)}${afterUsed.length ? `（反応を理由・注意点に使った候補：${afterUsed.map((c) => c.name).join("・")}）` : ""}${afterLearn ? "（打診履歴・反応の反映を明記）" : ""}`;
    console.log(`  ${detail}  分析 $${analysis.run_usd.toFixed(3)}／提案 $${again.usd.toFixed(3)}`);
    return {
      check: { name: "アンケート分析 → 書き戻し → 次の提案が変わる", pass: changed, detail },
      record: { event_id: SURVEY_EVENT, request_id: req.id, analysis, writebacks: log, before: b, after: a, analysis_usd: analysis.run_usd, proposal_usd: again.usd },
    };
  });
}
