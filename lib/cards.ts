// The notebook (ネタ帳): data/cards.json.
// Every write goes through validation: evidence must be real activity ids by the card's
// owner, and published ids must be real items by the same person. Nothing invalid is saved.
import fs from "node:fs";
import { activities, employeeById, employees, published, requests } from "./data";
import { internalTermProblems } from "./plainText";
import { blogPublishedIds } from "./moreSources";
import { dataFile } from "./dataSource";
import { DEMO_ID, demoFile, demoPersonOn } from "./demoPerson";
import { readCardOverlay, writeCardOverlay } from "./runtime";

// Follows DATA_SOURCE (lib/dataSource.ts). Resolved on each use so .env loaded after import still applies.
const FILE = () => dataFile("cards.json");

export type CardFormat = "talk" | "lt" | "blog";
export type PublicationStatus = "unpublished" | "blogged" | "talked";
export type OutreachResult = "approved" | "accepted" | "declined" | "published";
export type DeclineReason = "theme_mismatch" | "busy" | "schedule_conflict" | "other";

export interface OutreachEntry {
  date: string;
  request_id: string;
  result: OutreachResult;
  reason: DeclineReason | null;
  event_date: string | null;
}

export interface Card {
  card_id: string;
  employee_id: string;
  summary: string;
  themes: string[];
  evidence_activity_ids: string[];
  format: CardFormat;
  format_reason: string;
  publication_status: PublicationStatus;
  published_ids: string[];
  latest_activity_date: string;
  /** "公開しました" posts: a record of publication, not evidence of the work. */
  announcement_activity_ids: string[];
  /** Requests that named this person. Evidence for a nominee who has no activity on the theme. */
  evidence_request_ids: string[];
  /** Theme ideas the agent proposed for a reviewed card. Shown as 未確認 until accepted or rejected. */
  pending_themes: string[];
  outreach_history: OutreachEntry[];
  /** true once 技術広報 edited the card in the UI. Proposals prefer reviewed cards; the agent never overwrites their text. */
  reviewed: boolean;
  reviewed_at: string | null;
  /** Which fields 技術広報 changed by hand (summary / themes / format / format_reason / evidence). */
  edited_fields: string[];
  /** イベント後のアンケートから書き戻した反応（lib/surveys.ts）。提案中のものは技術広報が採用／見送りする */
  reactions?: Reaction[];
  created_at: string;
  updated_at: string;
}

/** イベント後の反応。reception＝登壇者のカードへの「反応のまとめ」、demand＝別の社員のカードへの「需要あり」 */
export interface Reaction {
  id: string;
  kind: "reception" | "demand";
  /** pending＝提案中（技術広報が採用／見送り）、adopted＝カードに入っている（提案で使う）、dismissed＝見送り */
  status: "pending" | "adopted" | "dismissed";
  event_id: string;
  event_title: string;
  event_date: string;
  /** reception：反応のまとめ1行。demand：参加者が聞きたいテーマ */
  text: string;
  hits: string[];
  stumbles: string[];
  /** コードで数えた件数・平均（reception だけ） */
  count: number | null;
  average: number | null;
  /** 根拠の回答id */
  response_ids: string[];
  /** demand：その声が出た登壇の登壇者 */
  from_speaker_id: string | null;
  added_at: string;
}

function readCardFile(file: string): Card[] {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as Card[]) : [];
}

/** 元のデータのカード（読むだけ）。DEMO_PERSON=on なら本人の初期のカード（data/sources/demo-person/cards.json）を後ろに足す */
export function baseCards(): Card[] {
  return [...readCardFile(FILE()), ...(demoPersonOn() ? readCardFile(demoFile("cards.json")) : [])].map(withDefaults);
}

/**
 * ネタ帳 = 元のデータのカードに、実行時のデータ（data/runtime/cards.json：画面での操作・ネタ帳の更新で変わったカード）を重ねたもの。
 * 本人（e031）のカードは、本人を入れているとき（DEMO_PERSON=on）だけ出す。
 */
export function loadCards(): Card[] {
  const base = baseCards();
  const o = readCardOverlay<Card>();
  const deleted = new Set(o.deleted);
  const changed = new Map(o.cards.filter((c) => c.employee_id !== DEMO_ID || demoPersonOn()).map((c) => [c.card_id, withDefaults(c)]));
  const out = base.filter((c) => !deleted.has(c.card_id)).map((c) => changed.get(c.card_id) ?? c);
  const known = new Set(base.map((c) => c.card_id));
  for (const c of changed.values()) if (!known.has(c.card_id)) out.push(c);
  return out;
}

const DEFAULTED = ["announcement_activity_ids", "evidence_request_ids", "pending_themes", "edited_fields", "reactions"] as const;

/** Cards written before these fields existed. */
function withDefaults(c: Card): Card {
  return {
    ...c,
    announcement_activity_ids: c.announcement_activity_ids ?? [],
    evidence_request_ids: c.evidence_request_ids ?? [],
    pending_themes: c.pending_themes ?? [],
    edited_fields: c.edited_fields ?? [],
    reactions: c.reactions ?? [],
  };
}

/** 保存するときは、読み込みで補う空の項目を書かない */
function withoutEmptyDefaults(c: Card): Card {
  const out = { ...c } as Record<string, unknown>;
  for (const k of DEFAULTED) if (Array.isArray(out[k]) && (out[k] as unknown[]).length === 0) delete out[k];
  return out as unknown as Card;
}

/**
 * 保存：元のデータのファイルは書かない。元のデータと中身が違うカードだけを、実行時のデータ（data/runtime/cards.json）に書く。
 * 本人（e031）を入れていないときに保存しても、前に保存した本人のカードは消さない。
 */
function saveCards(cards: Card[]) {
  const base = new Map(baseCards().map((c) => [c.card_id, JSON.stringify(c)]));
  const ids = new Set(cards.map((c) => c.card_id));
  const prev = readCardOverlay<Card>();
  const hidden = demoPersonOn() ? [] : prev.cards.filter((c) => c.employee_id === DEMO_ID); // 本人を入れていないときに見えていない分
  const changed = cards.filter((c) => base.get(c.card_id) !== JSON.stringify(withDefaults(c))).map(withoutEmptyDefaults);
  const deleted = [...base.keys()].filter((id) => !ids.has(id));
  // 消したカード：今の元のデータにあって、保存する一覧にないもの。今は見えていない元のデータ（本人の初期のカードなど）の分は前の記録を残す
  const keepDeleted = prev.deleted.filter((id) => !base.has(id));
  writeCardOverlay<Card>({ cards: [...changed, ...hidden.filter((h) => !ids.has(h.card_id))], deleted: [...new Set([...keepDeleted, ...deleted])] });
}

/** カード1枚をまとめて書き換える（lib/surveys.ts の書き戻し用）。見つからなければ null */
export function patchCard(cardId: string, fn: (c: Card) => Card): Card | null {
  const cards = loadCards();
  const i = cards.findIndex((c) => c.card_id === cardId);
  if (i < 0) return null;
  cards[i] = { ...fn(cards[i]), updated_at: now() };
  saveCards(cards);
  return cards[i];
}

export function getCardById(id: string): Card | undefined {
  return loadCards().find((c) => c.card_id === id);
}

const now = () => new Date().toISOString();

function nextCardId(cards: Card[], employeeId: string): string {
  const n = cards.filter((c) => c.employee_id === employeeId).length;
  let i = n + 1;
  while (cards.some((c) => c.card_id === `card-${employeeId}-${String(i).padStart(2, "0")}`)) i++;
  return `card-${employeeId}-${String(i).padStart(2, "0")}`;
}

export interface CardInput {
  card_id: string | null;
  employee_id: string;
  summary: string;
  themes: string[];
  evidence_activity_ids: string[];
  format: CardFormat;
  format_reason: string;
  published_ids: string[];
  announcement_activity_ids: string[];
  /** Only for a nominee: the request(s) that named them. Must name this employee. */
  evidence_request_ids?: string[];
}

/** Returns error messages; empty means the input can be saved. */
export function validateCardInput(input: CardInput, cards = loadCards()): string[] {
  const errs: string[] = [];
  if (!employeeById(input.employee_id)) errs.push(`社員 ${input.employee_id} は存在しません`);
  if (!input.summary?.trim()) errs.push("summary が空です");
  if (!Array.isArray(input.themes) || input.themes.length < 1 || input.themes.length > 3) errs.push("themes は1〜3個にしてください");
  if (!["talk", "lt", "blog"].includes(input.format)) errs.push("format は talk / lt / blog のどれかです");
  const acts = new Map(activities().map((a) => [a.id, a]));
  if (!input.evidence_activity_ids?.length && !input.published_ids?.length && !input.evidence_request_ids?.length) {
    errs.push("根拠の activity id がありません（発信済みの取り組みなら published_ids、指名された本人なら依頼のidを入れてください）");
  }
  if (input.evidence_request_ids?.length) {
    const reqs = new Map(requests().map((r) => [r.id, r]));
    for (const id of input.evidence_request_ids) {
      const r = reqs.get(id);
      if (!r) errs.push(`依頼 ${id} は存在しません`);
      else if (r.nominated_employee_id !== input.employee_id) errs.push(`依頼 ${id} は ${input.employee_id} を指名していません`);
    }
  }
  for (const id of input.evidence_activity_ids ?? []) {
    const a = acts.get(id);
    if (!a) errs.push(`根拠 ${id} は存在しない activity id です`);
    else if (a.author_id !== input.employee_id) errs.push(`根拠 ${id} は ${input.employee_id} の活動ではありません`);
  }
  for (const id of input.announcement_activity_ids ?? []) {
    const a = acts.get(id);
    if (!a) errs.push(`告知 ${id} は存在しない activity id です`);
    else if (a.author_id !== input.employee_id) errs.push(`告知 ${id} は ${input.employee_id} の活動ではありません`);
    if (input.evidence_activity_ids?.includes(id)) errs.push(`${id} が根拠と告知の両方に入っています。告知の投稿は告知だけに入れてください`);
  }
  if (input.announcement_activity_ids?.length && !input.published_ids?.length) {
    errs.push("告知の投稿があるときは、対応する published_ids を入れてください");
  }
  const pubs = new Map(published().map((p) => [p.id, p]));
  for (const id of input.published_ids ?? []) {
    const p = pubs.get(id);
    if (!p) errs.push(`published ${id} は存在しません`);
    else if (p.author_id !== input.employee_id) errs.push(`published ${id} は ${input.employee_id} の発信ではありません`);
  }
  if (input.card_id) {
    const c = cards.find((x) => x.card_id === input.card_id);
    if (!c) errs.push(`カード ${input.card_id} は存在しません。新しいカードなら card_id は null にしてください`);
    else if (c.employee_id !== input.employee_id) errs.push(`カード ${input.card_id} は別の社員のカードです`);
  }
  return errs;
}

function statusFrom(publishedIds: string[]): PublicationStatus {
  const pubs = published().filter((p) => publishedIds.includes(p.id));
  if (pubs.some((p) => p.genre === "登壇資料")) return "talked";
  if (pubs.length) return "blogged";
  return "unpublished";
}

/** Latest date among the work and announcement posts; falls back to the publication date. */
function latestDate(activityIds: string[], publishedIds: string[] = []): string {
  const a = activities()
    .filter((x) => activityIds.includes(x.id))
    .reduce((m, x) => (x.date > m ? x.date : m), "");
  if (a) return a;
  return published()
    .filter((p) => publishedIds.includes(p.id))
    .reduce((m, p) => (p.published_at.slice(0, 10) > m ? p.published_at.slice(0, 10) : m), "");
}

export interface UpsertOutcome {
  ok: boolean;
  errors: string[];
  action?: "created" | "updated" | "kept_reviewed";
  card?: Card;
  /** For reviewed cards: what changed without touching the human-edited text. */
  evidence_added?: string[];
  pending_themes_added?: string[];
}

const clean = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean);

/**
 * upsert_card: create or update a card.
 * Reviewed cards keep summary / themes / format as the human left them. Facts (evidence ids,
 * announcements, published ids, status, latest date) are still merged, and theme ideas that are
 * new become pending_themes (未確認) for the human to accept or reject.
 */
export function upsertCard(rawInput: CardInput): UpsertOutcome {
  // ブログ記事（blog の活動）を根拠に入れたら、同じ記事の発信の記録（published）も付ける → 「ブログ済み」になる
  const blogPubs = blogPublishedIds(rawInput.evidence_activity_ids ?? []);
  const input: CardInput = blogPubs.length ? { ...rawInput, published_ids: [...new Set([...(rawInput.published_ids ?? []), ...blogPubs])] } : rawInput;
  const cards = loadCards();
  const errors = validateCardInput(input, cards);
  // Agentが書く文（技術広報が読む）に内部の項目名・idを入れない。人が画面で直す editCard には掛けない
  errors.push(
    ...internalTermProblems([
      { where: "summary", text: input.summary },
      ...(input.themes ?? []).map((t) => ({ where: "themes", text: t })),
      { where: "format_reason", text: input.format_reason },
    ]),
  );
  if (errors.length) return { ok: false, errors };
  const t = now();
  const evidence = [...new Set(input.evidence_activity_ids ?? [])];
  const announcements = [...new Set(input.announcement_activity_ids ?? [])];
  const pubIds = [...new Set(input.published_ids ?? [])];
  const reqIds = [...new Set(input.evidence_request_ids ?? [])];
  const requestDate = () =>
    requests()
      .filter((r) => reqIds.includes(r.id))
      .reduce((m, r) => ((r.received_at ?? "") > m ? r.received_at ?? "" : m), "");

  if (!input.card_id) {
    const card: Card = {
      card_id: nextCardId(cards, input.employee_id),
      employee_id: input.employee_id,
      summary: input.summary.trim(),
      themes: clean(input.themes),
      evidence_activity_ids: evidence,
      format: input.format,
      format_reason: input.format_reason.trim(),
      publication_status: statusFrom(pubIds),
      published_ids: pubIds,
      latest_activity_date: latestDate([...evidence, ...announcements], pubIds) || requestDate(),
      announcement_activity_ids: announcements,
      evidence_request_ids: reqIds,
      pending_themes: [],
      outreach_history: [],
      reviewed: false,
      reviewed_at: null,
      edited_fields: [],
      created_at: t,
      updated_at: t,
    };
    saveCards([...cards, card]);
    return { ok: true, errors: [], action: "created", card };
  }

  const i = cards.findIndex((c) => c.card_id === input.card_id);
  const prev = cards[i];
  const mergedEvidence = [...new Set([...prev.evidence_activity_ids, ...evidence])];
  const mergedAnn = [...new Set([...prev.announcement_activity_ids, ...announcements])];
  const mergedPubs = [...new Set([...prev.published_ids, ...pubIds])];
  const facts = {
    evidence_activity_ids: mergedEvidence,
    announcement_activity_ids: mergedAnn,
    evidence_request_ids: [...new Set([...prev.evidence_request_ids, ...reqIds])],
    published_ids: mergedPubs,
    publication_status: statusFrom(mergedPubs),
    latest_activity_date: latestDate([...mergedEvidence, ...mergedAnn], mergedPubs) || prev.latest_activity_date,
    updated_at: t,
  };

  if (prev.reviewed) {
    const known = new Set([...prev.themes, ...prev.pending_themes]);
    const newIdeas = clean(input.themes).filter((th) => !known.has(th));
    const card: Card = { ...prev, ...facts, pending_themes: [...prev.pending_themes, ...newIdeas] };
    cards[i] = card;
    saveCards(cards);
    return {
      ok: true,
      errors: [],
      action: "kept_reviewed",
      card,
      evidence_added: mergedEvidence.filter((id) => !prev.evidence_activity_ids.includes(id)),
      pending_themes_added: newIdeas,
    };
  }

  const card: Card = {
    ...prev,
    ...facts,
    summary: input.summary.trim(),
    themes: clean(input.themes),
    format: input.format,
    format_reason: input.format_reason.trim(),
  };
  cards[i] = card;
  saveCards(cards);
  return { ok: true, errors: [], action: "updated", card };
}

/** One click in the UI: adopt or drop an agent-proposed theme on a reviewed card. */
export function resolvePendingTheme(cardId: string, theme: string, accept: boolean): UpsertOutcome {
  const cards = loadCards();
  const i = cards.findIndex((c) => c.card_id === cardId);
  if (i < 0) return { ok: false, errors: [`カード ${cardId} は存在しません`] };
  const prev = cards[i];
  if (!prev.pending_themes.includes(theme)) return { ok: false, errors: ["そのテーマ案はありません"] };
  if (accept && prev.themes.length >= 3) {
    return { ok: false, errors: ["テーマ案は3つまでです。先にカードを編集して1つ外してください"] };
  }
  const card: Card = {
    ...prev,
    themes: accept ? [...prev.themes, theme] : prev.themes,
    pending_themes: prev.pending_themes.filter((x) => x !== theme),
    updated_at: now(),
  };
  cards[i] = card;
  saveCards(cards);
  return { ok: true, errors: [], action: "updated", card };
}

/** Edit from the UI by 技術広報. Marks the card reviewed. */
export function editCard(
  cardId: string,
  patch: Partial<Pick<Card, "summary" | "themes" | "format" | "format_reason" | "evidence_activity_ids">>,
): UpsertOutcome {
  const cards = loadCards();
  const i = cards.findIndex((c) => c.card_id === cardId);
  if (i < 0) return { ok: false, errors: [`カード ${cardId} は存在しません`] };
  const prev = cards[i];
  const next: CardInput = {
    card_id: cardId,
    employee_id: prev.employee_id,
    summary: patch.summary ?? prev.summary,
    themes: patch.themes ?? prev.themes,
    evidence_activity_ids: patch.evidence_activity_ids ?? prev.evidence_activity_ids,
    format: patch.format ?? prev.format,
    format_reason: patch.format_reason ?? prev.format_reason,
    published_ids: prev.published_ids,
    announcement_activity_ids: prev.announcement_activity_ids,
    evidence_request_ids: prev.evidence_request_ids,
  };
  const errors = validateCardInput(next, cards);
  if (errors.length) return { ok: false, errors };
  const t = now();
  const changed: string[] = [];
  if (next.summary.trim() !== prev.summary) changed.push("summary");
  if (JSON.stringify(clean(next.themes)) !== JSON.stringify(prev.themes)) changed.push("themes");
  if (next.format !== prev.format) changed.push("format");
  if (next.format_reason.trim() !== prev.format_reason) changed.push("format_reason");
  if (JSON.stringify([...new Set(next.evidence_activity_ids)]) !== JSON.stringify(prev.evidence_activity_ids)) changed.push("evidence");
  const card: Card = {
    ...prev,
    edited_fields: [...new Set([...prev.edited_fields, ...changed])],
    summary: next.summary.trim(),
    themes: clean(next.themes),
    evidence_activity_ids: [...new Set(next.evidence_activity_ids)],
    latest_activity_date:
      latestDate([...next.evidence_activity_ids, ...prev.announcement_activity_ids], prev.published_ids) || prev.latest_activity_date,
    format: next.format,
    format_reason: next.format_reason.trim(),
    reviewed: true,
    reviewed_at: t,
    updated_at: t,
  };
  cards[i] = card;
  saveCards(cards);
  return { ok: true, errors: [], action: "updated", card };
}

/** record_outcome: append to the card's outreach history. */
export function appendOutreach(cardId: string, entry: Omit<OutreachEntry, "date">): Card | null {
  const cards = loadCards();
  const i = cards.findIndex((c) => c.card_id === cardId);
  if (i < 0) return null;
  const e: OutreachEntry = { ...entry, date: now().slice(0, 10) };
  cards[i] = { ...cards[i], outreach_history: [...cards[i].outreach_history, e], updated_at: now() };
  saveCards(cards);
  return cards[i];
}

/** Remove the last outreach entry matching request_id (used only by the evaluation to undo its own test write). */
export function removeOutreach(cardId: string, requestId: string) {
  const cards = loadCards();
  const i = cards.findIndex((c) => c.card_id === cardId);
  if (i < 0) return;
  const h = cards[i].outreach_history;
  const idx = h.map((x) => x.request_id).lastIndexOf(requestId);
  if (idx >= 0) cards[i] = { ...cards[i], outreach_history: [...h.slice(0, idx), ...h.slice(idx + 1)] };
  saveCards(cards);
}

// ---------------------------------------------------------------------------
// Read views used by tools and UI
// ---------------------------------------------------------------------------
export interface CardFilter {
  unpublished_only?: boolean;
  no_talk_experience?: boolean;
  business_unit?: string;
  reviewed_only?: boolean;
  employee_id?: string;
}

export function filterCards(cards: Card[], f: CardFilter = {}): Card[] {
  const emps = new Map(employees().map((e) => [e.id, e]));
  return cards.filter((c) => {
    const e = emps.get(c.employee_id);
    if (f.unpublished_only && c.publication_status !== "unpublished") return false;
    if (f.no_talk_experience && (e?.past_talk_count ?? 0) > 0) return false;
    if (f.business_unit && e?.business_unit !== f.business_unit) return false;
    if (f.reviewed_only && !c.reviewed) return false;
    if (f.employee_id && c.employee_id !== f.employee_id) return false;
    return true;
  });
}

export function outreachSummary(c: Card): string {
  if (!c.outreach_history.length) return "打診なし";
  return c.outreach_history
    .slice(-3)
    .map((h) => `${h.date} ${h.request_id} ${h.result}${h.reason ? `(${h.reason})` : ""}${h.event_date ? ` 開催${h.event_date}` : ""}`)
    .join("／");
}
