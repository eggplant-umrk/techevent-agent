// イベント後のアンケート（Googleフォームの CSV）を読み、登壇者のカードに書き戻す（v0.4）。
//
// コードの仕事：件数・平均・分布・登壇ごとの集計、空欄や無関係な回答の除外、点数の高い／低い登壇の洗い出し、
//               自由記述を文に分けること、不満の原文の一覧（言い回しは変えない）、カードに残す事実の文
// AI の仕事  ：文ごとに「良い点／不満／どちらでもない」を分ける（点数が高くても不満が混ざる）、
//               不満は「運営」か「内容」か・人を攻撃する言葉か、良い点のテーマ分け、要約、
//               次に聞きたいテーマのまとめ、別の社員のカードとの重なりの判断
// AI に渡すのは集計結果と自由記述だけ（CSV全体・満足度の1件ずつ・職種・個人情報は渡さない）。
//
// カードへの書き戻し：運営への不満は入れない（イベントのページだけ）。内容への不満は原文をカードに入れず
// 「前回は〇〇を指摘する声が N件」という事実だけ。人を攻撃する言葉はカードに一切残さない。
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getClient } from "./anthropic";
import { loadCards, patchCard, type Card, type Reaction } from "./cards";
import { TODAY } from "./config";
import { employeeById, employees, events, type EventRecord, type SurveyAnswer } from "./data";
import { internalTermProblems, PLAIN_TEXT_RULE } from "./plainText";
import { loadImport, surveys, type ColumnInfo } from "./surveyCsv";
import { chooseModels, recordUsage, runUsd, totalUsd } from "./usage";

export { surveys } from "./surveyCsv";

const MAX_CALLS = 3;
/** 分析結果の保存先。テストでは SURVEY_ANALYSIS_FILE で別のファイルに向ける */
const FILE = () => process.env.SURVEY_ANALYSIS_FILE || path.join(process.cwd(), "data", "survey_analysis.json");

// ---------------------------------------------------------------------------
// コード：集計・除外・洗い出し・文への分割
// ---------------------------------------------------------------------------
/** 感想として中身のない回答（コードで除外する） */
const EMPTY = /^(特になし|特にない|とくになし|なし|ない|無し|なし。|特になし。|-|ー|—|n\/?a)$/i;
export const isEmpty = (t: string | null | undefined) => !t || !t.trim() || EMPTY.test(t.trim());

export interface TalkStats {
  event_id: string;
  speaker_id: string;
  /** 回答の数（その登壇への回答） */
  count: number;
  /** 満足度の平均（小数1桁。画面にもこの値を出す）。満足度の書かれた回答だけで計算 */
  average: number;
  /** 満足度1〜5の件数 */
  distribution: [number, number, number, number, number];
  /** 感想のある回答（空欄・「特になし」を除く） */
  with_comment: number;
  /** 感想も次に聞きたいテーマも空で、分析から外した回答 */
  excluded: number;
  with_want_next: number;
  /** 点数の高い／低い登壇（コードで洗い出す） */
  highlight: "high" | "low" | null;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
export const HIGH_AVG = 4.5;
export const LOW_AVG = 3.3;

export function talkStats(eventId: string, all: SurveyAnswer[] = surveys()): TalkStats[] {
  const ev = events().find((e) => e.id === eventId);
  if (!ev) return [];
  return ev.speaker_ids
    .map((sp) => {
      const rows = all.filter((s) => s.event_id === eventId && s.talk_speaker_id === sp);
      const rated = rows.filter((r) => r.rating !== null);
      const dist: TalkStats["distribution"] = [0, 0, 0, 0, 0];
      for (const r of rated) dist[r.rating! - 1]++;
      const average = rated.length ? round1(rated.reduce((a, r) => a + r.rating!, 0) / rated.length) : 0;
      return {
        event_id: eventId,
        speaker_id: sp,
        count: rows.length,
        average,
        distribution: dist,
        with_comment: rows.filter((r) => !isEmpty(r.comment)).length,
        excluded: rows.filter((r) => isEmpty(r.comment) && isEmpty(r.want_next)).length,
        with_want_next: rows.filter((r) => !isEmpty(r.want_next)).length,
        highlight: rated.length ? (average >= HIGH_AVG ? "high" : average <= LOW_AVG ? "low" : null) : null,
      } satisfies TalkStats;
    })
    .filter((t) => t.count > 0);
}

export interface Sentence {
  /** 回答id#文の番号（例：ev019-r12#2） */
  id: string;
  answer_id: string;
  speaker_id: string;
  text: string;
}

/** 感想を文に分ける（。！？と改行）。空欄・「特になし」は入れない */
export function sentencesOf(eventId: string, all: SurveyAnswer[] = surveys()): Sentence[] {
  return all
    .filter((s) => s.event_id === eventId && !isEmpty(s.comment))
    .flatMap((s) =>
      s.comment
        .split(/(?<=[。！？!?])|\n/)
        .map((t) => t.trim())
        .filter((t) => t && !isEmpty(t))
        .map((text, i) => ({ id: `${s.id}#${i + 1}`, answer_id: s.id, speaker_id: s.talk_speaker_id, text })),
    );
}

// ---------------------------------------------------------------------------
// AI の出力と、それを検証して作る分析結果
// ---------------------------------------------------------------------------
export interface SentenceLabel {
  id: string;
  polarity: "good" | "bad" | "other";
  /** 良い点・不満のとき：運営（イベント全体：音響・時間・会場・配信・受付・懇親会・食事など）か、内容（登壇の中身）か。どちらでもない文は null */
  topic: "operation" | "content" | null;
  /** 人を攻撃する言葉 */
  attack: boolean;
}

export interface AnalysisInput {
  sentences: SentenceLabel[];
  /** speaker_id が null のテーマは「イベント全体」の良い点（懇親会・受付・会場など）。登壇者のカードには書き戻さない */
  positive_themes: Array<{ speaker_id: string | null; theme: string; sentence_ids: string[]; representative_ids: string[] }>;
  talks: Array<{
    speaker_id: string;
    /** 反応のまとめ1行（不満の原文や攻撃の言葉は入れない） */
    summary: string;
    /** 内容への不満を一言で（例：前提知識の多さ）。内容への不満がなければ null */
    content_issue: string | null;
    next_themes: Array<{ text: string; response_ids: string[]; overlaps_card_id: string | null }>;
  }>;
}

export interface NegativeItem {
  /** 原文（個人情報を伏せたもの以外は直さない） */
  text: string;
  sentence_ids: string[];
  speaker_ids: string[];
  /** 同じ文の数 */
  count: number;
  attack: boolean;
}
export interface PositiveTheme {
  /** null＝イベント全体の良い点（登壇者のカードには書き戻さない） */
  speaker_id: string | null;
  theme: string;
  /** その声を書いた回答の数（コードで数える） */
  count: number;
  sentence_ids: string[];
  representatives: Array<{ id: string; text: string }>;
}
export interface TalkAnalysis {
  speaker_id: string;
  summary: string;
  content_issue: string | null;
  /** 内容への不満（攻撃を除く）の文の数。カードに残す事実の数 */
  content_complaints: number;
  next_themes: AnalysisInput["talks"][number]["next_themes"];
  stats: TalkStats;
}
export interface EventAnalysis {
  event_id: string;
  analyzed_at: string;
  model: string;
  run_usd: number;
  labels: SentenceLabel[];
  /** ネガティブ：原文のまま全部。運営／内容に分けるだけ */
  negatives: { operation: NegativeItem[]; content: NegativeItem[] };
  /** ポジティブ：テーマごとに件数と代表的な声1〜2件 */
  positives: PositiveTheme[];
  talks: TalkAnalysis[];
  writebacks: string[];
}

export function loadAnalyses(): Record<string, EventAnalysis> {
  const f = FILE();
  if (!fs.existsSync(f)) return {};
  return JSON.parse(fs.readFileSync(f, "utf-8")) as Record<string, EventAnalysis>;
}
function saveAnalysis(a: EventAnalysis) {
  const all = loadAnalyses();
  all[a.event_id] = a;
  fs.writeFileSync(FILE(), JSON.stringify(all, null, 2) + "\n", "utf-8");
}

/** 数を書いた文（件数・平均・割合）。数字は画面がコードで出すので、Agent の文には書かせない */
const NUMBER_CLAIM = /[0-9０-９]+(?:[.．][0-9０-９]+)?\s*(?:件|人|名|点|%|％|割)|平均/;

/** 攻撃の文の中身（8文字以上の一部）が text に入っていないか */
function quotesAny(text: string, sources: string[]): boolean {
  const t = text.replace(/\s/g, "");
  return sources.some((s) => {
    const x = s.replace(/[。！？!?、\s]/g, "");
    for (let i = 0; i + 8 <= x.length; i++) if (t.includes(x.slice(i, i + 8))) return true;
    return false;
  });
}

/** 問題を文で返す。空なら保存してよい */
export function validateAnalysis(eventId: string, input: AnalysisInput, all: SurveyAnswer[] = surveys(), cards: Card[] = loadCards()): string[] {
  const errs: string[] = [];
  const sents = sentencesOf(eventId, all);
  const byId = new Map(sents.map((s) => [s.id, s]));
  const answers = new Map(all.filter((s) => s.event_id === eventId).map((s) => [s.id, s]));
  const speakers = talkStats(eventId, all).map((t) => t.speaker_id);

  // 文の分類：渡した文すべてに1回ずつ
  const seen = new Map<string, SentenceLabel>();
  for (const l of input.sentences ?? []) {
    if (!byId.has(l.id)) errs.push(`文 ${l.id} は存在しません`);
    else if (seen.has(l.id)) errs.push(`文 ${l.id} を2回分類しています`);
    seen.set(l.id, l);
    if (l.polarity !== "other" && l.topic !== "operation" && l.topic !== "content") errs.push(`${l.polarity === "bad" ? "不満" : "良い点"}の文 ${l.id} に運営か内容かがありません`);
  }
  const missing = sents.filter((s) => !seen.has(s.id)).map((s) => s.id);
  if (missing.length) errs.push(`分類していない文があります：${missing.slice(0, 10).join("、")}${missing.length > 10 ? ` ほか${missing.length - 10}文` : ""}`);

  // 良い点のテーマ：良い点の文を1回ずつ、その登壇の文だけ。代表は1〜2件
  const inTheme = new Set<string>();
  for (const t of input.positive_themes ?? []) {
    for (const id of t.sentence_ids ?? []) {
      const s = byId.get(id);
      if (!s) errs.push(`テーマ「${t.theme}」：文 ${id} は存在しません`);
      else if (seen.get(id)?.polarity !== "good") errs.push(`テーマ「${t.theme}」：文 ${id} は良い点に分けていません`);
      else if (t.speaker_id === null && seen.get(id)?.topic !== "operation") errs.push(`イベント全体のテーマ「${t.theme}」：文 ${id} は運営（イベント全体）に分けていません`);
      else if (t.speaker_id !== null && seen.get(id)?.topic !== "content") errs.push(`テーマ「${t.theme}」：文 ${id} は登壇の中身ではなくイベント全体の良い点です。登壇者のないテーマ（speaker_id=null）に入れてください`);
      else if (t.speaker_id !== null && s.speaker_id !== t.speaker_id) errs.push(`テーマ「${t.theme}」：文 ${id} は別の登壇への回答です`);
      if (inTheme.has(id)) errs.push(`文 ${id} が2つのテーマに入っています`);
      inTheme.add(id);
    }
    const reps = t.representative_ids ?? [];
    if (reps.length < 1 || reps.length > 2) errs.push(`テーマ「${t.theme}」の代表的な声は1〜2件にしてください`);
    for (const id of reps) if (!(t.sentence_ids ?? []).includes(id)) errs.push(`テーマ「${t.theme}」の代表 ${id} がテーマの文に入っていません`);
  }
  const goodLeft = [...seen.values()].filter((l) => l.polarity === "good" && !inTheme.has(l.id)).map((l) => l.id);
  if (goodLeft.length) errs.push(`テーマに入れていない良い点の文があります：${goodLeft.slice(0, 10).join("、")}`);

  // 登壇ごと
  const got = (input.talks ?? []).map((t) => t.speaker_id);
  for (const sp of speakers) if (!got.includes(sp)) errs.push(`${sp} の登壇のまとめがありません`);
  for (const sp of got) if (!speakers.includes(sp)) errs.push(`${sp} はこのイベントのアンケート対象の登壇者ではありません`);
  const attacks = [...seen.values()].filter((l) => l.attack).map((l) => byId.get(l.id)?.text ?? "");
  const badTexts = [...seen.values()].filter((l) => l.polarity === "bad").map((l) => byId.get(l.id)?.text ?? "");
  for (const t of input.talks ?? []) {
    const content = [...seen.values()].filter((l) => l.polarity === "bad" && l.topic === "content" && !l.attack && byId.get(l.id)?.speaker_id === t.speaker_id);
    if (content.length && !t.content_issue?.trim()) errs.push(`${t.speaker_id} は内容への不満があるので、content_issue に何を指摘されたかを一言で書いてください`);
    if (!content.length && t.content_issue) errs.push(`${t.speaker_id} は内容への不満がないので、content_issue は null にしてください`);
    if (t.content_issue && t.content_issue.length > 30) errs.push(`${t.speaker_id} の content_issue は30文字までの一言にしてください`);
    if (!t.summary?.trim()) errs.push(`${t.speaker_id} の反応のまとめが空です`);
    for (const n of t.next_themes ?? []) {
      if (!n.response_ids?.length) errs.push(`${t.speaker_id} の次に聞きたいテーマ「${n.text}」に根拠の回答idがありません`);
      for (const id of n.response_ids ?? []) {
        const a = answers.get(id);
        if (!a) errs.push(`回答 ${id} は存在しません`);
        else if (a.talk_speaker_id !== t.speaker_id) errs.push(`回答 ${id} は ${t.speaker_id} の登壇への回答ではありません`);
        else if (isEmpty(a.want_next)) errs.push(`回答 ${id} は次に聞きたいテーマが空欄です`);
      }
      if (n.overlaps_card_id) {
        const c = cards.find((x) => x.card_id === n.overlaps_card_id);
        if (!c) errs.push(`カード ${n.overlaps_card_id} は存在しません`);
        else if (c.employee_id === t.speaker_id) errs.push(`カード ${n.overlaps_card_id} は登壇者本人のカードです。重なりは別の社員のカードだけにしてください`);
        else if (c.publication_status !== "unpublished") errs.push(`カード ${n.overlaps_card_id} は未発信のカードではありません`);
      }
    }
    // カードに入る文：攻撃の言葉・不満の原文を入れない
    for (const [where, text] of [["反応のまとめ", t.summary], ["内容への不満の一言", t.content_issue ?? ""]] as const) {
      if (text && quotesAny(text, attacks)) errs.push(`${t.speaker_id} の${where}に人を攻撃する言葉が入っています`);
      if (text && quotesAny(text, badTexts)) errs.push(`${t.speaker_id} の${where}に不満の原文が入っています（事実だけを短く）`);
    }
  }
  const texts = [
    ...(input.talks ?? []).flatMap((t) => [
      { where: `${t.speaker_id} の反応のまとめ`, text: t.summary },
      { where: `${t.speaker_id} の内容への不満の一言`, text: t.content_issue },
      ...(t.next_themes ?? []).map((n) => ({ where: `${t.speaker_id} の次に聞きたいテーマ`, text: n.text })),
    ]),
    ...(input.positive_themes ?? []).map((p) => ({ where: "良い点のテーマ", text: p.theme })),
  ];
  errs.push(...internalTermProblems(texts));
  for (const x of texts) if (x.text && NUMBER_CLAIM.test(x.text)) errs.push(`${x.where}に件数・平均などの数字が入っています（数字は画面がコードで出すので書かない）`);
  for (const p of input.positive_themes ?? []) if (quotesAny(p.theme, attacks)) errs.push(`良い点のテーマ「${p.theme}」に人を攻撃する言葉が入っています`);
  return errs;
}

/** 保存した分析結果から、AI の出力を組み立て直す（結合テストが保存結果を今の検証で判定し直すのに使う） */
export function inputOf(a: Pick<EventAnalysis, "labels" | "positives" | "talks">): AnalysisInput {
  return {
    sentences: a.labels,
    positive_themes: a.positives.map((p) => ({ speaker_id: p.speaker_id, theme: p.theme, sentence_ids: p.sentence_ids, representative_ids: p.representatives.map((r) => r.id) })),
    talks: a.talks.map((t) => ({ speaker_id: t.speaker_id, summary: t.summary, content_issue: t.content_issue, next_themes: t.next_themes })),
  };
}

/** 検証を通った AI の出力から、画面とカードに出すもの（コード）を作る */
export function buildAnalysis(eventId: string, input: AnalysisInput, all: SurveyAnswer[] = surveys()): Omit<EventAnalysis, "analyzed_at" | "model" | "run_usd" | "writebacks"> {
  const sents = new Map(sentencesOf(eventId, all).map((s) => [s.id, s]));
  const stats = talkStats(eventId, all);
  const negatives = { operation: [] as NegativeItem[], content: [] as NegativeItem[] };
  for (const l of input.sentences) {
    if (l.polarity !== "bad" || !l.topic) continue;
    const s = sents.get(l.id)!;
    const list = negatives[l.topic];
    const same = list.find((x) => x.text === s.text && x.attack === l.attack);
    if (same) {
      same.sentence_ids.push(s.id);
      same.count++;
      if (!same.speaker_ids.includes(s.speaker_id)) same.speaker_ids.push(s.speaker_id);
    } else list.push({ text: s.text, sentence_ids: [s.id], speaker_ids: [s.speaker_id], count: 1, attack: l.attack });
  }
  for (const k of ["operation", "content"] as const) negatives[k].sort((a, b) => b.count - a.count);
  const positives: PositiveTheme[] = input.positive_themes
    .map((t) => ({
      speaker_id: t.speaker_id,
      theme: t.theme.trim(),
      count: new Set(t.sentence_ids.map((id) => sents.get(id)!.answer_id)).size,
      sentence_ids: t.sentence_ids,
      representatives: t.representative_ids.map((id) => ({ id, text: sents.get(id)!.text })),
    }))
    .sort((a, b) => b.count - a.count);
  const talks: TalkAnalysis[] = input.talks.map((t) => ({
    speaker_id: t.speaker_id,
    summary: t.summary.trim(),
    content_issue: t.content_issue?.trim() || null,
    content_complaints: input.sentences.filter((l) => l.polarity === "bad" && l.topic === "content" && !l.attack && sents.get(l.id)?.speaker_id === t.speaker_id).length,
    next_themes: t.next_themes.map((n) => ({ ...n, text: n.text.trim(), overlaps_card_id: n.overlaps_card_id || null })),
    stats: stats.find((s) => s.speaker_id === t.speaker_id)!,
  }));
  return { event_id: eventId, labels: input.sentences, negatives, positives, talks };
}

// ---------------------------------------------------------------------------
// AI への入力（集計結果と自由記述だけ）
// ---------------------------------------------------------------------------
const INSTRUCTIONS = `あなたはLayerXの技術広報を支えるAgentです。社外イベントのあとのアンケートの自由記述を読みます。集計（件数・平均・分布）はコードが済ませてあるので、あなたは文の意味を読む仕事だけをします。

今日は${TODAY}です。

# やること
1. 文ごとの分類（sentences）：渡したすべての文に1回ずつ
   - polarity：good（良い点）／bad（不満・改善してほしいこと・分からなかったこと）／other（どちらでもない・イベントと関係ない）。1つの回答に良い点と不満が混ざることがある。点数が高い回答でも、不満の文は bad にする
   - topic（good・bad のとき）：operation（運営・イベント全体：音響・マイク・時間・開始の遅れ・会場・寒さ・配信・受付・質疑の時間・懇親会・食事など、登壇の中身と関係ないこと）／content（登壇の中身：分かりやすい・具体的・難しい・速い・資料・抽象的・前提知識など）。other は null
   - attack：人を攻撃する言葉（登壇者や人への侮辱・人格の否定）なら true。内容への率直な批判は攻撃ではない
2. 良い点のテーマ（positive_themes）：good の文をテーマでまとめる。good の文はどれか1つのテーマに必ず入れる。代表的な声を1〜2文選ぶ（representative_ids）
   - 登壇の中身の良い点（topic=content）は、その登壇の speaker_id のテーマに
   - 懇親会・受付・会場など登壇と関係ない良い点（topic=operation）は、speaker_id を null にした「イベント全体」のテーマに（登壇者のカードには書き戻さない）
3. 登壇ごと（talks）
   - summary：反応のまとめ1行。登壇者のカードに残るので、不満の原文や攻撃の言葉は入れない
   - content_issue：内容への不満（攻撃を除く）があるとき、何を指摘されたかを一言で（例：前提知識の多さ／話す速さ／資料の文字の小ささ）。なければ null。15文字くらいの名詞句で、自分の言葉に言い換える。感想の文から8文字以上続けて写すとコードが差し戻す（summary も同じ）
   - next_themes：「次に聞きたいテーマ」の回答をまとめる。根拠の回答idを付ける。別の社員の未発信カード（下の一覧）と中身が重なるときは overlaps_card_id にそのカード、重ならなければ null
4. submit_survey_analysis を1回呼んで終わる

# 書き方
- 件数・平均・割合などの数字は書かない（画面がコードで出す）
- ${PLAIN_TEXT_RULE}`;

function cardLine(c: Card) {
  const e = employeeById(c.employee_id);
  return `- ${c.card_id}｜${e?.name ?? c.employee_id}（${e?.business_unit ?? ""}）｜${c.themes.join("／")}｜${c.summary.slice(0, 80)}`;
}

let SYSTEM: string | undefined;
function buildSystem() {
  const unpublished = loadCards().filter((c) => c.publication_status === "unpublished");
  return `${INSTRUCTIONS}\n\n# 別の社員の未発信カード（重なりを探す相手）\n${unpublished.map(cardLine).join("\n")}`;
}

/** AI に渡す文。集計結果と、自由記述（文に分けたもの）と、次に聞きたいテーマだけ。満足度の1件ずつ・職種・個人情報は渡さない */
export function eventMessage(ev: EventRecord, all: SurveyAnswer[] = surveys()): string {
  const cards = loadCards();
  const sents = sentencesOf(ev.id, all);
  const parts = [`# イベント\n${ev.title}（${ev.date}・${ev.series}）`];
  for (const st of talkStats(ev.id, all)) {
    const e = employeeById(st.speaker_id);
    const own = cards.filter((c) => c.employee_id === st.speaker_id);
    const wants = all.filter((s) => s.event_id === ev.id && s.talk_speaker_id === st.speaker_id && !isEmpty(s.want_next));
    parts.push(
      [
        `## 登壇：${st.speaker_id} ${e?.name ?? ""}（${e?.role ?? ""}）`,
        `本人のカード：${own.length ? own.map((c) => c.themes[0]).join("／") : "なし"}`,
        `集計（コード）：回答${st.count}件・満足度の平均${st.average}・感想あり${st.with_comment}件${st.highlight === "high" ? "・満足度が高い登壇" : st.highlight === "low" ? "・満足度が低い登壇" : ""}`,
        `感想の文（文のid｜文）：`,
        ...sents.filter((s) => s.speaker_id === st.speaker_id).map((s) => `${s.id}｜${s.text}`),
        `次に聞きたいテーマ（回答id｜テーマ）：`,
        ...(wants.length ? wants.map((s) => `${s.id}｜${s.want_next}`) : ["（なし）"]),
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

export const SUBMIT_SURVEY_DEF: Anthropic.Tool = {
  name: "submit_survey_analysis",
  description: "アンケートの読み取り結果を提出する。これを呼んだら作業は終わり。",
  input_schema: {
    type: "object",
    properties: {
      sentences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            polarity: { type: "string", enum: ["good", "bad", "other"] },
            topic: { type: ["string", "null"], enum: ["operation", "content", null] },
            attack: { type: "boolean" },
          },
          required: ["id", "polarity", "topic", "attack"],
          additionalProperties: false,
        },
      },
      positive_themes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            speaker_id: { type: ["string", "null"], description: "登壇の中身の良い点はその登壇者、イベント全体の良い点は null" },
            theme: { type: "string" },
            sentence_ids: { type: "array", items: { type: "string" } },
            representative_ids: { type: "array", items: { type: "string" } },
          },
          required: ["speaker_id", "theme", "sentence_ids", "representative_ids"],
          additionalProperties: false,
        },
      },
      talks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            speaker_id: { type: "string" },
            summary: { type: "string" },
            content_issue: { type: ["string", "null"] },
            next_themes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  response_ids: { type: "array", items: { type: "string" } },
                  overlaps_card_id: { type: ["string", "null"] },
                },
                required: ["text", "response_ids", "overlaps_card_id"],
                additionalProperties: false,
              },
            },
          },
          required: ["speaker_id", "summary", "content_issue", "next_themes"],
          additionalProperties: false,
        },
      },
    },
    required: ["sentences", "positive_themes", "talks"],
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// 書き戻し（コード）
// ---------------------------------------------------------------------------
const nowIso = () => new Date().toISOString();

/** 登壇者の、書き戻し先のカード（いちばん新しいもの） */
function speakerCard(speakerId: string, cards: Card[]): Card | undefined {
  return cards.filter((c) => c.employee_id === speakerId).sort((a, b) => (a.latest_activity_date < b.latest_activity_date ? 1 : -1))[0];
}

/** 同じidの反応は、見送り・採用済みならそのまま、提案中なら新しい内容に置き換える */
function upsertReaction(list: Reaction[], r: Reaction): Reaction[] {
  const prev = list.find((x) => x.id === r.id);
  if (prev && prev.status !== "pending") return list;
  return [...list.filter((x) => x.id !== r.id), r];
}

/** カードに残す内容への不満の事実（コードで組み立てる。原文は入れない） */
export function contentFact(t: Pick<TalkAnalysis, "content_issue" | "content_complaints">): string | null {
  if (!t.content_complaints || !t.content_issue) return null;
  return `前回は${t.content_issue}を指摘する声が${t.content_complaints}件`;
}

export function writeBack(ev: EventRecord, a: Pick<EventAnalysis, "talks" | "positives">): string[] {
  const lines: string[] = [];
  for (const t of a.talks) {
    const name = employeeById(t.speaker_id)?.name ?? t.speaker_id;
    const card = speakerCard(t.speaker_id, loadCards());
    if (!card) lines.push(`${name}さんはカードがないため、反応を書き戻せませんでした`);
    else {
      const fact = contentFact(t);
      const reception: Reaction = {
        id: `rx-${ev.id}-${t.speaker_id}`,
        kind: "reception",
        status: card.reviewed ? "pending" : "adopted",
        event_id: ev.id,
        event_title: ev.title,
        event_date: ev.date,
        text: t.summary,
        // 良い点はテーマ名と件数だけ（代表的な声の原文は入れない）。運営への不満・攻撃の言葉は入れない
        hits: a.positives.filter((p) => p.speaker_id === t.speaker_id).map((p) => `${p.theme}（${p.count}件）`),
        stumbles: fact ? [fact] : [],
        count: t.stats.count,
        average: t.stats.average,
        response_ids: [...new Set(a.positives.filter((p) => p.speaker_id === t.speaker_id).flatMap((p) => p.sentence_ids.map((id) => id.split("#")[0])))],
        from_speaker_id: null,
        added_at: nowIso(),
      };
      const ownThemes = t.next_themes.filter((n) => !n.overlaps_card_id).map((n) => n.text);
      let added: string[] = [];
      patchCard(card.card_id, (c) => {
        const known = new Set([...c.themes, ...c.pending_themes]);
        added = ownThemes.filter((x) => x && !known.has(x));
        return { ...c, reactions: upsertReaction(c.reactions ?? [], reception), pending_themes: [...c.pending_themes, ...added] };
      });
      lines.push(card.reviewed ? `${name}さんのカード（確認済み）：内容は変えず、反応のまとめを提案` : `${name}さんのカードに反応のまとめを追記`);
      if (added.length) lines.push(`${name}さんのカードにテーマ案（未確認）を提案「${added.join("」「")}」`);
    }
    t.next_themes.forEach((n, i) => {
      if (!n.overlaps_card_id) return;
      const target = loadCards().find((c) => c.card_id === n.overlaps_card_id);
      if (!target) return;
      const demand: Reaction = {
        id: `dm-${ev.id}-${t.speaker_id}-${i + 1}`,
        kind: "demand",
        status: "pending",
        event_id: ev.id,
        event_title: ev.title,
        event_date: ev.date,
        text: n.text,
        hits: [],
        stumbles: [],
        count: null,
        average: null,
        response_ids: n.response_ids,
        from_speaker_id: t.speaker_id,
        added_at: nowIso(),
      };
      patchCard(target.card_id, (c) => ({ ...c, reactions: upsertReaction(c.reactions ?? [], demand) }));
      lines.push(`${employeeById(target.employee_id)?.name ?? target.employee_id}さんのカードに「需要あり」を提案「${n.text}」`);
    });
  }
  return lines;
}

/** カードに入ってはいけないもの（運営への不満・不満の原文・攻撃の言葉・イベント全体の良い点）が入っていないか。問題を文で返す */
export function cardLeakProblems(a: Pick<EventAnalysis, "negatives" | "event_id" | "positives">, cards: Card[] = loadCards()): string[] {
  const bad = [...a.negatives.operation, ...a.negatives.content].map((n) => n.text);
  const eventWide = (a.positives ?? []).filter((p) => p.speaker_id === null);
  const eventTexts = eventWide.flatMap((p) => p.representatives.map((r) => r.text));
  const eventThemes = new Set(eventWide.map((p) => p.theme));
  const out: string[] = [];
  for (const c of cards)
    for (const r of (c.reactions ?? []).filter((x) => x.event_id === a.event_id)) {
      const texts = [r.text, ...r.hits, ...r.stumbles];
      if (texts.some((t) => quotesAny(t, bad))) out.push(`${c.card_id} の反応に不満の原文（運営・内容・攻撃）が入っています`);
      if (texts.some((t) => quotesAny(t, eventTexts)) || r.hits.some((h) => eventThemes.has(h.replace(/（\d+件）$/, ""))))
        out.push(`${c.card_id} の反応にイベント全体の良い点（懇親会・受付・会場など）が入っています`);
    }
  return out;
}

/** 画面の1クリック：提案中の反応を採用（カードに入れる）か見送る */
export function resolveReaction(cardId: string, reactionId: string, accept: boolean): { ok: boolean; error?: string; card?: Card } {
  const c = loadCards().find((x) => x.card_id === cardId);
  const r = c?.reactions?.find((x) => x.id === reactionId);
  if (!c || !r) return { ok: false, error: "その提案は見つかりません" };
  if (r.status !== "pending") return { ok: false, error: "その提案はもう決まっています" };
  const card = patchCard(cardId, (x) => ({
    ...x,
    reactions: (x.reactions ?? []).map((y) => (y.id === reactionId ? { ...y, status: accept ? "adopted" : "dismissed" } : y)),
  }));
  return { ok: true, card: card ?? undefined };
}

/** 提案（get_card・search_cards）に渡す、採用済みの反応の文 */
export function reactionLines(c: Card): string[] {
  return (c.reactions ?? [])
    .filter((r) => r.status === "adopted")
    .map((r) =>
      r.kind === "reception"
        ? `${r.event_date}「${r.event_title}」での反応（回答${r.count}件・満足度の平均${r.average}）：${r.text}${r.hits.length ? `／良かった点：${r.hits.join("、")}` : ""}${r.stumbles.length ? `／${r.stumbles.join("、")}` : ""}`
        : `需要あり：${r.event_date}「${r.event_title}」の参加者が「${r.text}」を聞きたいと答えた`,
    );
}

// ---------------------------------------------------------------------------
// 分析の実行（NDJSON で作業ログを流す）
// ---------------------------------------------------------------------------
export type SurveyEvent =
  | { type: "start"; run_id: string; model: string; event_id: string; talks: number; answers: number; sentences: number; excluded: number }
  | { type: "step"; n: number; max: number }
  | { type: "rejected"; errors: string[] }
  | { type: "writeback"; message: string }
  | { type: "usage"; run_usd: number; total_usd: number }
  | { type: "error"; message: string }
  | { type: "done"; analysis: EventAnalysis; run_usd: number; total_usd: number };

/** Agent の代わりに入力を返す関数（テスト用）。本番は Claude を呼ぶ */
export type Analyzer = (system: string, message: string, previous: Anthropic.MessageParam[]) => Promise<{
  input: AnalysisInput | null;
  content: Anthropic.ContentBlock[];
  tool_use_id: string | null;
  model: string;
}>;

export function claudeAnalyzer(runId: string): Analyzer {
  const client = getClient();
  const { loop: model } = chooseModels();
  return async (system, message, previous) => {
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: [SUBMIT_SURVEY_DEF],
      messages: previous.length ? previous : [{ role: "user", content: message }],
      output_config: { effort: "medium" },
    });
    recordUsage(runId, "survey", res.model, res.usage);
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    return { input: (use?.input as AnalysisInput) ?? null, content: res.content, tool_use_id: use?.id ?? null, model: res.model };
  };
}

export async function analyzeEvent(
  eventId: string,
  emit: (e: SurveyEvent) => void,
  opts: { runId?: string; analyzer?: Analyzer } = {},
): Promise<EventAnalysis | null> {
  const ev = events().find((e) => e.id === eventId);
  if (!ev) {
    emit({ type: "error", message: "そのイベントは見つかりません" });
    return null;
  }
  const stats = talkStats(eventId);
  if (!stats.length) {
    emit({ type: "error", message: "このイベントにはアンケートの回答がありません。CSVを取り込んでください" });
    return null;
  }
  const runId = opts.runId ?? randomUUID();
  const analyzer = opts.analyzer ?? claudeAnalyzer(runId);
  emit({
    type: "start",
    run_id: runId,
    model: opts.analyzer ? "test" : chooseModels().loop,
    event_id: eventId,
    talks: stats.length,
    answers: stats.reduce((a, s) => a + s.count, 0),
    sentences: sentencesOf(eventId).length,
    excluded: stats.reduce((a, s) => a + s.excluded, 0),
  });
  const system = (SYSTEM ??= buildSystem());
  const message = eventMessage(ev);
  const messages: Anthropic.MessageParam[] = [];
  let accepted: AnalysisInput | null = null;
  let model = "";

  for (let call = 1; call <= MAX_CALLS && !accepted; call++) {
    emit({ type: "step", n: call, max: MAX_CALLS });
    const out = await analyzer(system, message, messages);
    model = out.model;
    emit({ type: "usage", run_usd: runUsd(runId), total_usd: totalUsd() });
    if (!out.input) {
      emit({ type: "error", message: "読み取り結果が提出されませんでした" });
      break;
    }
    const errors = validateAnalysis(eventId, out.input);
    if (!errors.length) {
      accepted = out.input;
      break;
    }
    emit({ type: "rejected", errors });
    if (!messages.length) messages.push({ role: "user", content: message });
    messages.push({ role: "assistant", content: out.content });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: out.tool_use_id ?? "", is_error: true, content: `直してからもう一度提出してください：\n${errors.join("\n")}` }],
    });
  }
  if (!accepted) {
    emit({ type: "error", message: "検証を通る読み取り結果が作れませんでした。時間をおいてもう一度押してください" });
    return null;
  }

  const built = buildAnalysis(eventId, accepted);
  const writebacks = writeBack(ev, built);
  for (const w of writebacks) emit({ type: "writeback", message: w });
  const analysis: EventAnalysis = { ...built, analyzed_at: nowIso(), model, run_usd: runUsd(runId), writebacks };
  saveAnalysis(analysis);
  emit({ type: "done", analysis, run_usd: analysis.run_usd, total_usd: totalUsd() });
  return analysis;
}

// ---------------------------------------------------------------------------
// 画面用
// ---------------------------------------------------------------------------
export interface EventListItem {
  id: string;
  title: string;
  date: string;
  series: string;
  attendees: number;
  speakers: Array<{ id: string; name: string }>;
  answers: number;
  analyzed: boolean;
}

export function listEvents(): EventListItem[] {
  const all = surveys();
  const analyses = loadAnalyses();
  return events()
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((e) => ({
      id: e.id,
      title: e.title,
      date: e.date,
      series: e.series,
      attendees: e.attendees,
      speakers: e.speaker_ids.map((id) => ({ id, name: employeeById(id)?.name ?? id })),
      answers: all.filter((s) => s.event_id === e.id).length,
      analyzed: !!analyses[e.id],
    }));
}

export function eventDetail(eventId: string) {
  const ev = events().find((e) => e.id === eventId);
  if (!ev) return null;
  const cards = loadCards();
  const all = surveys();
  const stats = talkStats(eventId, all);
  const imp = loadImport(eventId);
  return {
    event: ev,
    talks: ev.speaker_ids.map((id) => {
      const emp = employees().find((x) => x.id === id);
      return {
        speaker_id: id,
        name: emp?.name ?? id,
        business_unit: emp?.business_unit ?? "",
        card_id: speakerCard(id, cards)?.card_id ?? null,
        stats: stats.find((s) => s.speaker_id === id) ?? null,
      };
    }),
    /** 取り込みの結果：列の意味（個人情報の列は捨てた・読み取れない列は無視した）と、どの登壇か分からなかった行 */
    source: imp ? { source: imp.source, imported_at: imp.imported_at, rows: imp.rows, columns: imp.columns as ColumnInfo[], unmatched_rows: imp.unmatched_rows } : null,
    /** 回答（個人情報の列は入っていない）。根拠の回答を開くのに使う */
    answers: all.filter((s) => s.event_id === eventId),
    sentences: sentencesOf(eventId, all),
    analysis: (loadAnalyses()[eventId] as EventAnalysis | undefined) ?? null,
  };
}
