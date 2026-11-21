// The notebook (ネタ帳): data/cards.json.
// Every write goes through validation: evidence must be real activity ids by the card's
// owner, and published ids must be real items by the same person. Nothing invalid is saved.
import fs from "node:fs";
import path from "node:path";
import { activities, employeeById, employees, published } from "./data";

const FILE = path.join(process.cwd(), "data", "cards.json");

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
  outreach_history: OutreachEntry[];
  /** true once 技術広報 edited the card in the UI. Proposals prefer reviewed cards; the agent never overwrites their text. */
  reviewed: boolean;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function loadCards(): Card[] {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, "utf-8")) as Card[];
}

function saveCards(cards: Card[]) {
  fs.writeFileSync(FILE, JSON.stringify(cards, null, 2) + "\n", "utf-8");
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
}

/** Returns error messages; empty means the input can be saved. */
export function validateCardInput(input: CardInput, cards = loadCards()): string[] {
  const errs: string[] = [];
  if (!employeeById(input.employee_id)) errs.push(`社員 ${input.employee_id} は存在しません`);
  if (!input.summary?.trim()) errs.push("summary が空です");
  if (!Array.isArray(input.themes) || input.themes.length < 1 || input.themes.length > 3) errs.push("themes は1〜3個にしてください");
  if (!["talk", "lt", "blog"].includes(input.format)) errs.push("format は talk / lt / blog のどれかです");
  const acts = new Map(activities().map((a) => [a.id, a]));
  if (!input.evidence_activity_ids?.length) errs.push("根拠の activity id がありません");
  for (const id of input.evidence_activity_ids ?? []) {
    const a = acts.get(id);
    if (!a) errs.push(`根拠 ${id} は存在しない activity id です`);
    else if (a.author_id !== input.employee_id) errs.push(`根拠 ${id} は ${input.employee_id} の活動ではありません`);
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

function latestDate(ids: string[]): string {
  const acts = activities().filter((a) => ids.includes(a.id));
  return acts.reduce((m, a) => (a.date > m ? a.date : m), "");
}

export interface UpsertOutcome {
  ok: boolean;
  errors: string[];
  action?: "created" | "updated" | "kept_reviewed";
  card?: Card;
}

/** upsert_card: create or update a card. Reviewed cards keep their human-edited text; only evidence/status are merged. */
export function upsertCard(input: CardInput): UpsertOutcome {
  const cards = loadCards();
  const errors = validateCardInput(input, cards);
  if (errors.length) return { ok: false, errors };
  const t = now();
  const evidence = [...new Set(input.evidence_activity_ids)];
  const pubIds = [...new Set(input.published_ids ?? [])];

  if (!input.card_id) {
    const card: Card = {
      card_id: nextCardId(cards, input.employee_id),
      employee_id: input.employee_id,
      summary: input.summary.trim(),
      themes: input.themes.map((s) => s.trim()).filter(Boolean),
      evidence_activity_ids: evidence,
      format: input.format,
      format_reason: input.format_reason.trim(),
      publication_status: statusFrom(pubIds),
      published_ids: pubIds,
      latest_activity_date: latestDate(evidence),
      outreach_history: [],
      reviewed: false,
      reviewed_at: null,
      created_at: t,
      updated_at: t,
    };
    saveCards([...cards, card]);
    return { ok: true, errors: [], action: "created", card };
  }

  const i = cards.findIndex((c) => c.card_id === input.card_id);
  const prev = cards[i];
  const mergedEvidence = [...new Set([...prev.evidence_activity_ids, ...evidence])];
  const mergedPubs = [...new Set([...prev.published_ids, ...pubIds])];
  const base = {
    ...prev,
    evidence_activity_ids: mergedEvidence,
    published_ids: mergedPubs,
    publication_status: statusFrom(mergedPubs),
    latest_activity_date: latestDate(mergedEvidence),
    updated_at: t,
  };
  const card: Card = prev.reviewed
    ? base
    : {
        ...base,
        summary: input.summary.trim(),
        themes: input.themes.map((s) => s.trim()).filter(Boolean),
        format: input.format,
        format_reason: input.format_reason.trim(),
      };
  cards[i] = card;
  saveCards(cards);
  return { ok: true, errors: [], action: prev.reviewed ? "kept_reviewed" : "updated", card };
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
  };
  const errors = validateCardInput(next, cards);
  if (errors.length) return { ok: false, errors };
  const t = now();
  const card: Card = {
    ...prev,
    summary: next.summary.trim(),
    themes: next.themes.map((s) => s.trim()).filter(Boolean),
    evidence_activity_ids: [...new Set(next.evidence_activity_ids)],
    latest_activity_date: latestDate(next.evidence_activity_ids),
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
