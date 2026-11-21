// 受信箱の一覧と依頼の画面に出すもの（入口を受信箱に一本化する）。
// - 受信箱に届いた依頼（data/inbox.json）に、サンプルの依頼（data/requests.json）も「届いた依頼」として並べる
//   サンプルの依頼は自動では候補を出さない（API代がかかるため）。画面で「ネタ帳から候補を出す」を押すと出し、結果を保存する
// - それぞれに依頼の状態（lib/requestStage.ts。コードで決める）を付ける
// - 声かけ文・主催者への返事の下書きを保存して、承諾済みの依頼を開き直したときにも出す
// 評価用のデータ（requests.json）と結合テストの動きは変えない（ここは画面用の読み書きだけ）。
import { originalUrl } from "./originalUrl";
import { writeJsonAtomic } from "./fileStore";
import fs from "node:fs";
import { byTimeDesc, nowJst, todayJst } from "./clock";
import path from "node:path";
import type { AgentEvent, ProposalResult } from "./agent";
import { inboxEventDate } from "./archive";
import { loadCards } from "./cards";
import { activities, employeeById, requests } from "./data";
import type { OutreachDraft } from "./heavy";
import { detailView, getInboxItem, listInbox, listView, type InboxDetail, type InboxListItem } from "./inbox";
import { recordsFor, requestState, type RequestState } from "./requestStage";
import { eventUrlsIn } from "./eventUrls";

const SAMPLE_FILE = () => process.env.SAMPLE_PROPOSALS_FILE || path.join(process.cwd(), "data", "sample_proposals.json");
const DRAFT_FILE = () => process.env.DRAFTS_FILE || path.join(process.cwd(), "data", "drafts.json");

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}
function writeJson(file: string, value: unknown) {
  writeJsonAtomic(file, value);
}

// ---- サンプルの依頼の候補（画面で出したもの） --------------------------------------------
interface SavedProposal {
  result: ProposalResult;
  events: AgentEvent[];
  run_usd: number;
  saved_at: string;
  opened_at: string | null;
}
const loadSamples = () => readJson<Record<string, SavedProposal>>(SAMPLE_FILE(), {});

export const isSampleRequest = (id: string) => requests().some((r) => r.id === id);

/** 画面で候補を出したら保存する（サンプルの依頼だけ。受信箱の依頼は受信箱が保存する） */
export function saveSampleProposal(requestId: string, result: ProposalResult, events: AgentEvent[], runUsd: number) {
  if (!isSampleRequest(requestId)) return;
  const all = loadSamples();
  all[requestId] = { result, events, run_usd: runUsd, saved_at: nowJst(), opened_at: all[requestId]?.opened_at ?? null };
  writeJson(SAMPLE_FILE(), all);
}

export function markSampleOpened(requestId: string) {
  const all = loadSamples();
  const s = all[requestId];
  if (!s || s.opened_at) return;
  all[requestId] = { ...s, opened_at: nowJst() };
  writeJson(SAMPLE_FILE(), all);
}

// ---- 下書き（声かけ文と主催者への返事） ----------------------------------------------------
const draftKey = (requestId: string, employeeId: string) => `${requestId}:${employeeId}`;
/**
 * 下書きに使う候補（/api/draft）。ブラウザから来た候補の文は使わず、保存済みの候補（受信箱・サンプルの依頼の結果）から employee_id で引き直す。
 * 保存済みの結果がない依頼（その場で書いた依頼文など）は、ブラウザから来た値を長さで切り、根拠は実在する活動の id だけにする
 */
export function draftCandidate(
  body: { request_id?: string; candidate?: { employee_id?: unknown; theme?: unknown; reason?: unknown; evidence_activity_ids?: unknown } },
  activityIds: Set<string>,
): { employee_id: string; theme: string; reason: string; evidence_activity_ids: string[]; from: "saved" | "trimmed" } | null {
  const employeeId = typeof body.candidate?.employee_id === "string" ? body.candidate.employee_id : "";
  if (!employeeId) return null;
  // その場で書いた依頼文（custom…）には保存済みの結果がない
  if (body.request_id && !body.request_id.startsWith("custom")) {
    const saved = boardDetail(body.request_id)?.result?.candidates.find((c) => c.employee_id === employeeId);
    if (!saved) return null; // 保存済みの候補にいない人の下書きは作らない
    return { employee_id: saved.employee_id, theme: saved.theme, reason: saved.reason, evidence_activity_ids: saved.evidence.map((e) => e.id), from: "saved" };
  }
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  const ids = Array.isArray(body.candidate?.evidence_activity_ids) ? body.candidate!.evidence_activity_ids.filter((x): x is string => typeof x === "string" && activityIds.has(x)).slice(0, 10) : [];
  return { employee_id: employeeId, theme: str(body.candidate?.theme, 120), reason: str(body.candidate?.reason, 400), evidence_activity_ids: ids, from: "trimmed" };
}

export function saveDraft(requestId: string, employeeId: string, draft: OutreachDraft) {
  const all = readJson<Record<string, OutreachDraft & { saved_at: string }>>(DRAFT_FILE(), {});
  all[draftKey(requestId, employeeId)] = { ...draft, saved_at: nowJst() };
  writeJson(DRAFT_FILE(), all);
}
export function loadDraft(requestId: string, employeeId: string): OutreachDraft | null {
  return readJson<Record<string, OutreachDraft>>(DRAFT_FILE(), {})[draftKey(requestId, employeeId)] ?? null;
}

// ---- 一覧と詳細 ----------------------------------------------------------------------------
export type BoardSource = InboxListItem["source"] | "sample";

export interface BoardListItem extends Omit<InboxListItem, "source"> {
  source: BoardSource;
  /** 依頼の状態（コードで決める） */
  state: RequestState;
  /** 開催日（分かれば） */
  event_date: string | null;
}

export interface BoardDetail extends Omit<InboxDetail, "source"> {
  source: BoardSource;
  state: RequestState;
  event_date: string | null;
  /** 承諾した人への主催者への返事の下書き（保存してあれば） */
  accepted_reply: { name: string; text: string } | null;
  /** 会話（依頼文）の中にあるイベントの告知ページの URL（connpass など。lib/eventUrls.ts でコードが取り出す） */
  event_urls: string[];
}

const nameOf = (id: string) => employeeById(id)?.name ?? id;

function stateOf(requestId: string, base: "new" | "processing" | "ready" | "error", eventDate: string | null): RequestState {
  return requestState(base, recordsFor(requestId, loadCards(), nameOf), eventDate, todayJst());
}

function sampleList(): BoardListItem[] {
  const saved = loadSamples();
  return requests()
    .filter((r) => !(r.event?.date && r.event.date < todayJst()))
    .map((r) => {
      const s = saved[r.id];
      const date = r.event?.date ?? null;
      return {
        id: r.id,
        source: "sample" as const,
        status: "ready" as const,
        received_at: `${r.received_at ?? todayJst()}T09:00:00+09:00`,
        is_new: !s?.opened_at,
        title: r.event?.title ?? r.id,
        candidate_names: s?.result.candidates.map((c) => c.name) ?? [],
        no_fit: !!s && s.result.candidates.length === 0,
        error: null,
        permalink: null,
        state: stateOf(r.id, s ? "ready" : "new", date),
        event_date: date,
      };
    });
}

/** 同じ文かどうかを比べる形（前後の空白・改行の違い、全角の空白、空白の続きは同じとみなす） */
export const sameTextKey = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[ \t　]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").trim();

/**
 * 同じ文の依頼が、すでに受信箱にあるか（アーカイブ〔開催日が過ぎたもの〕は除く）。あればその id。
 * 貼り直し・連打で同じ依頼が何件も入らないように、追加の窓口が使う。
 */
export function findActiveDuplicate(text: string): string | null {
  const key = sameTextKey(text);
  if (!key) return null;
  const hit = listInbox()
    .filter((it) => sameTextKey(it.text) === key)
    .find((it) => stateOf(it.id, it.status, inboxEventDate(it)).stage !== "archived");
  return hit?.id ?? null;
}

/** 受信箱の一覧：届いた依頼（開催日が過ぎたものはアーカイブへ）とサンプルの依頼。新しい順 */
export function boardList(): BoardListItem[] {
  const inbox = listInbox()
    .map((it) => {
      const date = inboxEventDate(it);
      const v = listView(it);
      return { ...v, state: stateOf(it.id, it.status, date), event_date: date };
    })
    .filter((x) => x.state.stage !== "archived");
  return [...inbox, ...sampleList()].sort((a, b) => byTimeDesc(a.received_at, b.received_at));
}

function replyFor(requestId: string, state: RequestState): BoardDetail["accepted_reply"] {
  for (const p of state.accepted_by) {
    const d = loadDraft(requestId, p.employee_id);
    if (d?.organizer_reply) return { name: p.name, text: d.organizer_reply };
  }
  return null;
}

/** 依頼の画面：受信箱の1件（またはサンプルの依頼）を、状態つきで返す */
/** 保存済みの候補の根拠に、元のページの URL を補う（前に保存した結果にも付くように。架空の活動は付かない） */
function withEvidenceUrls<T extends { result: ProposalResult | null }>(d: T): T {
  if (!d.result) return d;
  const acts = new Map(activities().map((a) => [a.id, a]));
  return {
    ...d,
    result: {
      ...d.result,
      candidates: d.result.candidates.map((c) => ({
        ...c,
        evidence: c.evidence.map((e) => ({ ...e, url: e.url ?? originalUrl(acts.get(e.id)?.url) })),
      })),
    },
  };
}

export function boardDetail(id: string): BoardDetail | null {
  const d = boardDetailRaw(id);
  return d ? withEvidenceUrls(d) : null;
}

function boardDetailRaw(id: string): BoardDetail | null {
  const it = getInboxItem(id);
  if (it) {
    const date = inboxEventDate(it);
    const state = stateOf(id, it.status, date);
    return { ...detailView(it), state, event_date: date, accepted_reply: replyFor(id, state), event_urls: eventUrlsIn(it.text) };
  }
  const r = requests().find((x) => x.id === id);
  if (!r) return null;
  const s = loadSamples()[id];
  const item = sampleList().find((x) => x.id === id);
  const date = r.event?.date ?? null;
  const state = item?.state ?? stateOf(id, s ? "ready" : "new", date);
  return {
    id,
    source: "sample",
    status: "ready",
    received_at: `${r.received_at ?? todayJst()}T09:00:00+09:00`,
    is_new: !s?.opened_at,
    title: r.event?.title ?? id,
    candidate_names: s?.result.candidates.map((c) => c.name) ?? [],
    no_fit: !!s && s.result.candidates.length === 0,
    error: null,
    permalink: null,
    text: r.message,
    nominee_name: r.nominated_employee_id ? nameOf(r.nominated_employee_id) : null,
    intake: null,
    result: s?.result ?? null,
    events: s?.events ?? [],
    run_usd: s?.run_usd ?? 0,
    pitch_status: null,
    state,
    event_date: date,
    accepted_reply: replyFor(id, state),
    event_urls: eventUrlsIn(r.message),
  };
}
