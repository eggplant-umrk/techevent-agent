// イベント後のアンケートを Agent が読み、登壇者のカードに書き戻す（v0.4）。
// - 数字（件数・平均・分布）はコードで計算する。Agent の文には数字を書かせない
// - Agent の呼び出しは「ネタ帳を更新」と同じ形：1イベント1回、出力を検証して、だめなら差し戻す（最大3回）
// - 書き戻しはコード：登壇者のカードに「反応のまとめ」（確認済みなら提案）、次に聞きたいテーマはテーマ案（未確認）、
//   別の社員の未発信カードと重なるテーマはそのカードに「需要あり」の提案
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getClient } from "./anthropic";
import { loadCards, patchCard, type Card, type Reaction } from "./cards";
import { TODAY } from "./config";
import { employeeById, employees, events, surveys, type EventRecord, type SurveyAnswer } from "./data";
import { internalTermProblems, PLAIN_TEXT_RULE } from "./plainText";
import { chooseModels, recordUsage, runUsd, totalUsd } from "./usage";

const MAX_CALLS = 3;
/** 分析結果の保存先。テストでは SURVEY_ANALYSIS_FILE で別のファイルに向ける */
const FILE = () => process.env.SURVEY_ANALYSIS_FILE || path.join(process.cwd(), "data", "survey_analysis.json");

// ---------------------------------------------------------------------------
// 数字（コードで計算）
// ---------------------------------------------------------------------------
export interface TalkStats {
  event_id: string;
  speaker_id: string;
  count: number;
  /** 平均（小数1桁に丸めた値。画面にもこの値を出す） */
  average: number;
  /** 満足度1〜5の件数 */
  distribution: [number, number, number, number, number];
  with_comment: number;
  with_want_next: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function talkStats(eventId: string, all: SurveyAnswer[] = surveys()): TalkStats[] {
  const ev = events().find((e) => e.id === eventId);
  if (!ev) return [];
  return ev.speaker_ids
    .map((sp) => {
      const rows = all.filter((s) => s.event_id === eventId && s.talk_speaker_id === sp);
      const dist: TalkStats["distribution"] = [0, 0, 0, 0, 0];
      for (const r of rows) dist[r.rating - 1]++;
      return {
        event_id: eventId,
        speaker_id: sp,
        count: rows.length,
        average: rows.length ? round1(rows.reduce((a, r) => a + r.rating, 0) / rows.length) : 0,
        distribution: dist,
        with_comment: rows.filter((r) => r.comment.trim()).length,
        with_want_next: rows.filter((r) => r.want_next?.trim()).length,
      };
    })
    .filter((t) => t.count > 0);
}

// ---------------------------------------------------------------------------
// 分析結果
// ---------------------------------------------------------------------------
export interface Point {
  text: string;
  response_ids: string[];
}
export interface NextTheme extends Point {
  /** 別の社員の未発信カードと重なるとき、そのカード */
  overlaps_card_id: string | null;
}
export interface TalkAnalysis {
  speaker_id: string;
  /** 反応のまとめ1行 */
  summary: string;
  hits: Point[];
  stumbles: Point[];
  next_themes: NextTheme[];
  stats: TalkStats;
}
export interface EventAnalysis {
  event_id: string;
  analyzed_at: string;
  model: string;
  run_usd: number;
  talks: TalkAnalysis[];
  /** 書き戻したこと（画面と作業ログに出す文） */
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

// ---------------------------------------------------------------------------
// 検証（コード）
// ---------------------------------------------------------------------------
/** 数を書いた文（件数・平均・割合）。数字は画面がコードで出すので、Agent の文には書かせない */
const NUMBER_CLAIM = /[0-9０-９]+(?:[.．][0-9０-９]+)?\s*(?:件|人|名|点|%|％|割)|平均/;

export interface AnalysisInput {
  talks: Array<{
    speaker_id: string;
    summary: string;
    hits: Point[];
    stumbles: Point[];
    next_themes: NextTheme[];
  }>;
}

/** 問題を文で返す。空なら保存してよい */
export function validateAnalysis(eventId: string, input: AnalysisInput, all: SurveyAnswer[] = surveys(), cards: Card[] = loadCards()): string[] {
  const errs: string[] = [];
  const byId = new Map(all.map((s) => [s.id, s]));
  const speakers = talkStats(eventId, all).map((t) => t.speaker_id);
  const got = (input.talks ?? []).map((t) => t.speaker_id);
  for (const sp of speakers) if (!got.includes(sp)) errs.push(`${sp} の登壇の分析がありません`);
  for (const sp of got) if (!speakers.includes(sp)) errs.push(`${sp} はこのイベントのアンケート対象の登壇者ではありません`);

  for (const t of input.talks ?? []) {
    const own = (ids: string[], where: string, need: "comment" | "want_next") => {
      if (!ids?.length) errs.push(`${t.speaker_id} の${where}に根拠の回答idがありません`);
      for (const id of ids ?? []) {
        const s = byId.get(id);
        if (!s) errs.push(`${t.speaker_id} の${where}：回答 ${id} は存在しません`);
        else if (s.event_id !== eventId || s.talk_speaker_id !== t.speaker_id) errs.push(`${t.speaker_id} の${where}：回答 ${id} はこの登壇への回答ではありません`);
        else if (need === "comment" && !s.comment.trim()) errs.push(`${t.speaker_id} の${where}：回答 ${id} は感想が空欄です`);
        else if (need === "want_next" && !s.want_next?.trim()) errs.push(`${t.speaker_id} の${where}：回答 ${id} は次に聞きたいテーマが空欄です`);
      }
    };
    if (!t.summary?.trim()) errs.push(`${t.speaker_id} の反応のまとめが空です`);
    for (const p of t.hits ?? []) own(p.response_ids, "刺さった点", "comment");
    for (const p of t.stumbles ?? []) own(p.response_ids, "つまずき・質問", "comment");
    for (const p of t.next_themes ?? []) {
      own(p.response_ids, "次に聞きたいテーマ", "want_next");
      if (p.overlaps_card_id) {
        const c = cards.find((x) => x.card_id === p.overlaps_card_id);
        if (!c) errs.push(`カード ${p.overlaps_card_id} は存在しません`);
        else if (c.employee_id === t.speaker_id) errs.push(`カード ${p.overlaps_card_id} は登壇者本人のカードです。重なりは別の社員のカードだけにしてください`);
        else if (c.publication_status !== "unpublished") errs.push(`カード ${p.overlaps_card_id} は未発信のカードではありません`);
      }
    }
    const texts = [
      { where: `${t.speaker_id} の反応のまとめ`, text: t.summary },
      ...(t.hits ?? []).map((p) => ({ where: `${t.speaker_id} の刺さった点`, text: p.text })),
      ...(t.stumbles ?? []).map((p) => ({ where: `${t.speaker_id} のつまずき・質問`, text: p.text })),
      ...(t.next_themes ?? []).map((p) => ({ where: `${t.speaker_id} の次に聞きたいテーマ`, text: p.text })),
    ];
    errs.push(...internalTermProblems(texts));
    for (const x of texts) {
      if (x.text && NUMBER_CLAIM.test(x.text)) errs.push(`${x.where}に件数・平均などの数字が入っています（数字は画面がコードで出すので書かない）`);
    }
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Agent への入力
// ---------------------------------------------------------------------------
const INSTRUCTIONS = `あなたはLayerXの技術広報を支えるAgentです。社外イベントが終わったあとのアンケートを読み、登壇ごとに「刺さった点」「多かった質問・つまずき」「次に聞きたいテーマ」をまとめます。まとめは登壇者のネタ帳カードに書き戻され、次に似た依頼が来たときの候補の理由・注意点に使われます。

今日は${TODAY}です。

# まとめ方
- 登壇ごとに、反応のまとめ1行（summary）、刺さった点（hits）、つまずき・質問（stumbles）、次に聞きたいテーマ（next_themes）を出す。それぞれ0〜3個。多かった声を優先する
- すべての点に、根拠の回答idを付ける（response_ids）。その登壇への回答だけを使う。刺さった点・つまずきは感想（comment）が書いてある回答、次に聞きたいテーマは「次に聞きたい」が書いてある回答を根拠にする
- 会場・食事・受付・配信の感想、「特になし」、空欄はノイズ。根拠に使わない
- 件数・平均・割合などの数字は書かない（画面がコードで計算して出す）。「多かった」「目立った」などの言葉で書く
- 次に聞きたいテーマが、別の社員の未発信カード（下の一覧）の中身と重なるときは overlaps_card_id にそのカードを入れる。登壇者本人のカードや、中身が重ならないカードは入れない（null）
- 次に聞きたいテーマは、参加者の言葉をもとに、そのまま登壇タイトルの候補になる形で書く
- ${PLAIN_TEXT_RULE}
- 書き終えたら submit_survey_analysis を1回呼んで終わる`;

function cardLine(c: Card) {
  const e = employeeById(c.employee_id);
  return `- ${c.card_id}｜${e?.name ?? c.employee_id}（${e?.business_unit ?? ""}）｜${c.themes.join("／")}｜${c.summary.slice(0, 80)}`;
}

let SYSTEM: string | undefined;
function buildSystem() {
  const unpublished = loadCards().filter((c) => c.publication_status === "unpublished");
  return `${INSTRUCTIONS}\n\n# 別の社員の未発信カード（重なりを探す相手）\n${unpublished.map(cardLine).join("\n")}`;
}

function eventMessage(ev: EventRecord): string {
  const all = surveys();
  const cards = loadCards();
  const parts = [`# イベント\n${ev.title}（${ev.date}・${ev.series}・参加${ev.attendees}人）`];
  for (const st of talkStats(ev.id, all)) {
    const e = employeeById(st.speaker_id);
    const own = cards.filter((c) => c.employee_id === st.speaker_id);
    const rows = all.filter((s) => s.event_id === ev.id && s.talk_speaker_id === st.speaker_id);
    parts.push(
      [
        `## 登壇：${st.speaker_id} ${e?.name ?? ""}（${e?.role ?? ""}）`,
        `本人のカード：${own.length ? own.map((c) => c.themes[0]).join("／") : "なし"}`,
        `回答（id｜満足度｜職種｜感想｜次に聞きたい）：`,
        ...rows.map((r) => `${r.id}｜${r.rating}｜${r.role ?? "-"}｜${r.comment.trim() || "（空欄）"}｜${r.want_next ?? "（空欄）"}`),
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

const POINT = {
  type: "object",
  properties: { text: { type: "string" }, response_ids: { type: "array", items: { type: "string" } } },
  required: ["text", "response_ids"],
  additionalProperties: false,
} as const;

export const SUBMIT_SURVEY_DEF: Anthropic.Tool = {
  name: "submit_survey_analysis",
  description: "アンケートのまとめを提出する。登壇ごとに1つ。これを呼んだら作業は終わり。",
  input_schema: {
    type: "object",
    properties: {
      talks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            speaker_id: { type: "string" },
            summary: { type: "string", description: "反応のまとめ1行。数字は書かない" },
            hits: { type: "array", items: POINT },
            stumbles: { type: "array", items: POINT },
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
          required: ["speaker_id", "summary", "hits", "stumbles", "next_themes"],
          additionalProperties: false,
        },
      },
    },
    required: ["talks"],
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

export function writeBack(ev: EventRecord, talks: TalkAnalysis[]): string[] {
  const lines: string[] = [];
  for (const t of talks) {
    const name = employeeById(t.speaker_id)?.name ?? t.speaker_id;
    const card = speakerCard(t.speaker_id, loadCards());
    if (!card) lines.push(`${name}さんはカードがないため、反応を書き戻せませんでした`);
    else {
      const reception: Reaction = {
        id: `rx-${ev.id}-${t.speaker_id}`,
        kind: "reception",
        status: card.reviewed ? "pending" : "adopted",
        event_id: ev.id,
        event_title: ev.title,
        event_date: ev.date,
        text: t.summary,
        hits: t.hits.map((p) => p.text),
        stumbles: t.stumbles.map((p) => p.text),
        count: t.stats.count,
        average: t.stats.average,
        response_ids: [...new Set([...t.hits, ...t.stumbles].flatMap((p) => p.response_ids))],
        from_speaker_id: null,
        added_at: nowIso(),
      };
      const ownThemes = t.next_themes.filter((n) => !n.overlaps_card_id).map((n) => n.text.trim());
      let added: string[] = [];
      patchCard(card.card_id, (c) => {
        const known = new Set([...c.themes, ...c.pending_themes]);
        added = ownThemes.filter((x) => x && !known.has(x));
        return { ...c, reactions: upsertReaction(c.reactions ?? [], reception), pending_themes: [...c.pending_themes, ...added] };
      });
      lines.push(
        card.reviewed
          ? `${name}さんのカード（確認済み）：内容は変えず、反応のまとめを提案`
          : `${name}さんのカードに反応のまとめを追記`,
      );
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
        text: n.text.trim(),
        hits: [],
        stumbles: [],
        count: null,
        average: null,
        response_ids: n.response_ids,
        from_speaker_id: t.speaker_id,
        added_at: nowIso(),
      };
      patchCard(target.card_id, (c) => ({ ...c, reactions: upsertReaction(c.reactions ?? [], demand) }));
      const tn = employeeById(target.employee_id)?.name ?? target.employee_id;
      lines.push(`${tn}さんのカードに「需要あり」を提案「${n.text.trim()}」`);
    });
  }
  return lines;
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

/** 提案（get_card・search_cards）に渡す、採用済みの反応の文。idや数字の項目名は入れない */
export function reactionLines(c: Card): string[] {
  return (c.reactions ?? [])
    .filter((r) => r.status === "adopted")
    .map((r) =>
      r.kind === "reception"
        ? `${r.event_date}「${r.event_title}」での反応（回答${r.count}件・満足度の平均${r.average}）：${r.text}${r.hits.length ? `／刺さった点：${r.hits.join("、")}` : ""}${r.stumbles.length ? `／つまずき：${r.stumbles.join("、")}` : ""}`
        : `需要あり：${r.event_date}「${r.event_title}」の参加者が「${r.text}」を聞きたいと答えた`,
    );
}

// ---------------------------------------------------------------------------
// 分析の実行（NDJSON で作業ログを流す）
// ---------------------------------------------------------------------------
export type SurveyEvent =
  | { type: "start"; run_id: string; model: string; event_id: string; talks: number; answers: number }
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
      tool_choice: { type: "tool", name: SUBMIT_SURVEY_DEF.name },
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
    emit({ type: "error", message: "このイベントにはアンケートの回答がありません" });
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
      emit({ type: "error", message: "まとめが提出されませんでした" });
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
    emit({ type: "error", message: "検証を通るまとめが作れませんでした。時間をおいてもう一度押してください" });
    return null;
  }

  const talks: TalkAnalysis[] = accepted.talks.map((t) => ({
    speaker_id: t.speaker_id,
    summary: t.summary.trim(),
    hits: t.hits,
    stumbles: t.stumbles,
    next_themes: t.next_themes.map((n) => ({ ...n, overlaps_card_id: n.overlaps_card_id || null })),
    stats: stats.find((s) => s.speaker_id === t.speaker_id)!,
  }));
  const writebacks = writeBack(ev, talks);
  for (const w of writebacks) emit({ type: "writeback", message: w });
  const analysis: EventAnalysis = { event_id: eventId, analyzed_at: nowIso(), model, run_usd: runUsd(runId), talks, writebacks };
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
  const stats = talkStats(eventId);
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
    answers: surveys().filter((s) => s.event_id === eventId),
    analysis: loadAnalyses()[eventId] ?? null,
  };
}
