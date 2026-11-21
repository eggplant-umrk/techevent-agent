// アーカイブ（終わったイベント）。開催日が過ぎたかどうかはコードで判定する。
// - 受信箱の依頼：本文しかないので、本文の日付から開催日を読む（lib/dates.ts の日付の読み取り）
// - サンプルの依頼（requests.json）：event.date
// - 過去のイベント（events.json）
import { loadCards } from "./cards";
import { todayJst } from "./clock";
import { employeeById, events, requests } from "./data";
import { findDates } from "./dates";
import { listInbox, type InboxItem } from "./inbox";
import { listEvents } from "./surveys";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 本文から開催日を読む（コード）。
 * 「開催」「当日」の近くにある日付を優先し、なければ最初の日付。年がなければ、受信日より後になる年にする。
 */
export function eventDateFromText(text: string, receivedAt: string): string | null {
  const ds = findDates(text);
  if (!ds.length) return null;
  const near = ds.find((d) => /開催|当日/.test(text.slice(Math.max(0, d.index - 12), d.index + d.text.length + 8)));
  const d = near ?? ds[0];
  const year = /^\d{4}/.test(d.text) ? Number(d.text.slice(0, 4)) : null;
  const received = receivedAt.slice(0, 10);
  const recvYear = Number(received.slice(0, 4));
  const make = (y: number) => `${y}-${pad(d.start.m)}-${pad(d.start.d)}`;
  if (year) return make(year);
  // 年が書かれていない：受信日の30日前より前になるなら翌年とみなす
  const sameYear = make(recvYear);
  const limit = new Date(Date.parse(received) - 30 * 86_400_000).toISOString().slice(0, 10);
  return sameYear < limit ? make(recvYear + 1) : sameYear;
}

export const isPast = (date: string | null | undefined, today = todayJst()) => !!date && date < today;

export function inboxEventDate(it: Pick<InboxItem, "text" | "received_at"> & { intake?: InboxItem["intake"] }): string | null {
  // 会話から1日に決まった日程を読み取れていればそれを使う（日程が未定なら受信箱に残す）
  if (it.intake) return it.intake.date;
  return eventDateFromText(it.text, it.received_at);
}

/** 受信箱に出す依頼か（開催日が過ぎたものはアーカイブへ） */
export function isActiveInboxItem(it: Pick<InboxItem, "text" | "received_at"> & { intake?: InboxItem["intake"] }, today = todayJst()): boolean {
  return !isPast(inboxEventDate(it), today);
}

// ---------------------------------------------------------------------------
// 一覧と詳細
// ---------------------------------------------------------------------------
export type ArchiveKind = "inbox" | "request" | "event";

export interface ArchiveRow {
  kind: ArchiveKind;
  id: string;
  title: string;
  date: string;
  /** 登壇した人（決まっていれば）。いなければ空 */
  speakers: string[];
  /** 過去のイベントだけ：アンケートの回答数と、分析済みか */
  answers?: number;
  analyzed?: boolean;
}

function outcomesOf(requestId: string) {
  const out: Array<{ employee_id: string; name: string; result: string; reason: string | null; date: string }> = [];
  for (const c of loadCards()) {
    for (const h of c.outreach_history) {
      if (h.request_id !== requestId) continue;
      out.push({ employee_id: c.employee_id, name: employeeById(c.employee_id)?.name ?? c.employee_id, result: h.result, reason: h.reason, date: h.date });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

const acceptedNames = (requestId: string) => [...new Set(outcomesOf(requestId).filter((o) => o.result === "accepted").map((o) => o.name))];

export function archiveRows(today = todayJst()): ArchiveRow[] {
  const rows: ArchiveRow[] = [];
  for (const it of listInbox()) {
    const d = inboxEventDate(it);
    if (!isPast(d, today)) continue;
    const first = it.text.split(/\r?\n/).find((l) => l.trim()) ?? it.text;
    rows.push({ kind: "inbox", id: it.id, title: first.length > 70 ? first.slice(0, 69) + "…" : first, date: d!, speakers: acceptedNames(it.id) });
  }
  for (const r of requests()) {
    if (!isPast(r.event?.date, today)) continue;
    rows.push({ kind: "request", id: r.id, title: r.event?.title ?? r.id, date: r.event!.date, speakers: acceptedNames(r.id) });
  }
  // 過去のイベント：アンケートの件数と分析済みかは、イベント後の画面（lib/surveys.ts）の一覧から
  const survey = new Map(listEvents().map((e) => [e.id, e]));
  for (const ev of events()) {
    if (!isPast(ev.date, today)) continue;
    const sv = survey.get(ev.id);
    rows.push({
      kind: "event",
      id: ev.id,
      title: ev.title,
      date: ev.date,
      speakers: ev.speaker_ids.map((s) => employeeById(s)?.name ?? s),
      answers: sv?.answers ?? 0,
      analyzed: sv?.analyzed ?? false,
    });
  }
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export interface ArchiveDetail extends ArchiveRow {
  /** 会場・形式など（あれば） */
  place: string | null;
  series: string | null;
  /** 依頼の本文（依頼のときだけ） */
  text: string | null;
  /** 候補に出た人（依頼のときだけ） */
  candidates: string[];
  /** 依頼の結果（承認・承諾・辞退・公開）。カードの打診履歴から */
  outcomes: Array<{ name: string; result: string; reason: string | null; date: string }>;
}

export function archiveDetail(kind: ArchiveKind, id: string, today = todayJst()): ArchiveDetail | undefined {
  const row = archiveRows(today).find((r) => r.kind === kind && r.id === id);
  if (!row) return undefined;
  if (kind === "inbox") {
    const it = listInbox().find((x) => x.id === id)!;
    return { ...row, place: null, series: null, text: it.text, candidates: it.result?.candidates.map((c) => c.name) ?? [], outcomes: outcomesOf(id) };
  }
  if (kind === "request") {
    const r = requests().find((x) => x.id === id)!;
    return {
      ...row,
      place: r.event?.venue ?? null,
      series: null,
      text: r.message,
      candidates: [],
      outcomes: outcomesOf(id),
    };
  }
  const ev = events().find((x) => x.id === id)!;
  return { ...row, place: ev.venue, series: ev.series, text: null, candidates: [], outcomes: [] };
}
