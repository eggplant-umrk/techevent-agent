import type { FeedbackInput, ReasonCodes, RequestTrace } from "./feedback";
// Every call the screens make. In mock mode (?mock in the URL) nothing that costs money or
// writes to data/ is called: reads still come from data/ via the GET routes, and the agent,
// the draft, and every write are answered from fixtures and kept in memory.
import { mockApi } from "./mock";
import type {
  AgentEvent,
  BlogIdea,
  Card,
  CardPatch,
  DraftBody,
  EventDetail,
  EventListItem,
  ImportResult,
  InboxDetail,
  InboxListItem,
  ModelChoice,
  NotebookCard,
  NotebookEvent,
  OutcomeBody,
  OutreachDraft,
  SpeakingRequest,
  SurveyEvent,
  VenueDraftBody,
  VenueEvent,
  ArchiveDetail,
  BoardDetail,
  BoardListItem,
  SurveyVoice,
  UnassignedCard,
  ArchiveKind,
  ArchiveRow,
  PersonDetail,
  PersonPatch,
  PersonRow,
  Person,
} from "./types";

export interface DraftResponse {
  draft: OutreachDraft;
  model: string;
  fell_back: boolean;
  run_usd: number;
  total_usd: number;
}

export interface Api {
  mock: boolean;
  cards(): Promise<{ cards: NotebookCard[]; units: string[] }>;
  /** trace_allowed：実行の記録の画面を開けるか（見せる用では、この端末〔127.0.0.1〕からだけ） */
  state(): Promise<{ models: ModelChoice; pending_employees: number; trace_allowed?: boolean; feedback_reasons?: ReasonCodes }>;
  /** 使われた結果（この候補は違う・下書きを直して使った など）を送る。記録の側（POST /api/feedback）へ */
  feedback(input: FeedbackInput): Promise<void>;
  /** 記録の側（POST /api/feedback）があるか。ないうちは、使われた結果のボタンを出さない */
  feedbackReady(): Promise<boolean>;
  /** 1つの依頼の実行の記録。まだなければ null */
  trace(requestId: string): Promise<RequestTrace | null>;
  requests(): Promise<SpeakingRequest[]>;
  runAgent(body: { request_id: string; custom_text?: string }, onEvent: (e: AgentEvent) => void): Promise<void>;
  updateNotebook(onEvent: (e: NotebookEvent) => void): Promise<void>;
  blogIdeas(): Promise<{ ideas: BlogIdea[]; run_usd: number; total_usd: number }>;
  draft(body: DraftBody): Promise<DraftResponse>;
  outcome(body: OutcomeBody): Promise<Card>;
  /** 承諾の取り消し：その依頼の最後の記録（承諾）を1つ戻す */
  undoOutcome(requestId: string, cardId: string): Promise<void>;
  editCard(cardId: string, patch: CardPatch): Promise<void>;
  resolvePending(cardId: string, theme: string, accept: boolean): Promise<void>;
  /** 受信箱の一覧（新しい順） */
  inbox(): Promise<BoardListItem[]>;
  /** 手で追加（受信箱に入る入口の1つ） */
  /** 同じ文の依頼がすでにあれば、足さずにその id と duplicate: true */
  inboxAdd(text: string): Promise<{ id: string; duplicate?: boolean }>;
  /** 受信箱の1件（保存した候補と作業ログつき） */
  inboxDetail(id: string): Promise<BoardDetail>;
  /** 開いた印を付ける */
  inboxOpen(id: string): Promise<void>;
  /** 「依頼ではなさそう」と読んだ1件を、人が依頼として進める（候補づくりは裏で続く） */
  inboxProceed(id: string): Promise<void>;
  /** 過去イベントの一覧（新しい順） */
  events(): Promise<EventListItem[]>;
  /** イベントの詳細（数字はコードで計算済み） */
  eventDetail(id: string): Promise<EventDetail>;
  /** アンケートを分析してカードに書き戻す（作業ログを流す） */
  analyzeEvent(id: string, onEvent: (e: SurveyEvent) => void): Promise<void>;
  /** イベント後の反応の提案を採用／見送り */
  resolveReaction(cardId: string, reactionId: string, accept: boolean): Promise<void>;
  /** Googleフォームの CSV を取り込む（個人情報の列は捨てる） */
  importSurvey(id: string, csv: string): Promise<ImportResult>;
  /** カード → 出し先を探す（作業ログを流す） */
  venues(cardId: string, onEvent: (e: VenueEvent) => void): Promise<void>;
  /** カード → 出し先：本人への声かけ文の下書き（送らない） */
  venueDraft(body: VenueDraftBody): Promise<DraftResponse>;
  /** ネタ帳タブ：人の一覧（社員全員） */
  people(): Promise<PersonRow[]>;
  /** ネタ帳タブ：人の詳細 */
  person(id: string): Promise<PersonDetail>;
  /** 人の情報を直す（直した項目は確認済みになり、Agent は上書きしない） */
  editPerson(id: string, patch: PersonPatch): Promise<Person>;
  /** アーカイブタブ：開催日が過ぎた依頼とイベント */
  archive(): Promise<ArchiveRow[]>;
  /** ネタ帳タブ：アンケートの声（参加者が今後聞いてみたい話） */
  voices(): Promise<SurveyVoice[]>;
  /** ネタ帳タブ：担当者未定のネタ（リリースノートから作ったカード） */
  unassigned(): Promise<UnassignedCard[]>;
  /** 担当者を割り当てる。その人のカードになり、一覧から消える */
  assignUnassigned(cardId: string, employeeId: string): Promise<{ card_id: string }>;
  archiveDetail(kind: ArchiveKind, id: string): Promise<ArchiveDetail>;
}

// 通信そのものに失敗したとき（サーバーが止まっている・つながらない）は、英語の「Failed to fetch」ではなく使う人向けの文にする
const safeFetch = (input: string, init?: RequestInit) =>
  fetch(input, init).catch(() => {
    throw new Error("サーバーにつながりませんでした。少し待ってから、もう一度押してください");
  });

async function json<T>(res: Response): Promise<T> {
  const j = await res.json().catch(() => ({ error: `サーバーから応答がありません（${res.status}）` }));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `エラー（${res.status}）`);
  return j as T;
}

async function readNdjson<T>(res: Response, onEvent: (e: T) => void) {
  if (!res.ok || !res.body) {
    await json(res);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) onEvent(JSON.parse(line) as T);
    }
  }
}

const post = (url: string, body?: unknown) =>
  safeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const realApi: Api = {
  mock: false,
  cards: () => safeFetch("/api/cards").then(json<{ cards: NotebookCard[]; units: string[] }>),
  state: () => safeFetch("/api/state").then(json<{ models: ModelChoice; pending_employees: number; trace_allowed?: boolean; feedback_reasons?: ReasonCodes }>),
  feedback: async (input) => {
    await json(await post("/api/feedback", input));
  },
  // 窓口があれば GET は 405（POST だけの窓口）など、なければ 404。1回だけ確かめる
  feedbackReady: async () => {
    try {
      const res = await safeFetch("/api/feedback", { method: "GET" });
      return res.status !== 404;
    } catch {
      return false;
    }
  },
  trace: async (requestId) => {
    const res = await safeFetch(`/api/traces/${encodeURIComponent(requestId)}`);
    if (res.status === 404) return null; // まだ記録がない（記録の側が入る前も、ここで null）
    return (await json<{ trace: RequestTrace | null }>(res)).trace;
  },
  requests: () => safeFetch("/api/requests").then(json<SpeakingRequest[]>),
  runAgent: async (body, onEvent) => readNdjson(await post("/api/agent", body), onEvent),
  updateNotebook: async (onEvent) => readNdjson(await post("/api/notebook"), onEvent),
  blogIdeas: async () => json(await post("/api/blog-ideas")),
  draft: async (body) => json(await post("/api/draft", body)),
  outcome: async (body) => (await json<{ card: Card }>(await post("/api/outcome", body))).card,
  undoOutcome: async (request_id, card_id) => {
    await json(await post("/api/outcome/undo", { request_id, card_id }));
  },
  editCard: async (card_id, patch) => {
    await json(await safeFetch("/api/cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card_id, patch }) }));
  },
  resolvePending: async (card_id, theme, accept) => {
    await json(await post("/api/cards/pending", { card_id, theme, accept }));
  },
  inbox: async () => (await json<{ items: BoardListItem[] }>(await safeFetch("/api/inbox"))).items,
  inboxAdd: async (text) => json(await post("/api/inbox", { text, source: "manual" })),
  inboxDetail: async (id) => json(await safeFetch(`/api/inbox/${encodeURIComponent(id)}/detail`)),
  inboxOpen: async (id) => {
    await json(await post(`/api/inbox/${encodeURIComponent(id)}/open`));
  },
  inboxProceed: async (id) => {
    await json(await post(`/api/inbox/${encodeURIComponent(id)}/proceed`));
  },
  events: async () => (await json<{ events: EventListItem[] }>(await safeFetch("/api/events"))).events,
  eventDetail: async (id) => json(await safeFetch(`/api/events/${encodeURIComponent(id)}`)),
  analyzeEvent: async (id, onEvent) => readNdjson(await post(`/api/events/${encodeURIComponent(id)}/analyze`), onEvent),
  resolveReaction: async (card_id, reaction_id, accept) => {
    await json(await post("/api/cards/reactions", { card_id, reaction_id, accept }));
  },
  importSurvey: async (id, csv) => json(await post(`/api/events/${encodeURIComponent(id)}/import`, { csv })),
  venues: async (cardId, onEvent) => readNdjson(await post("/api/venues", { card_id: cardId }), onEvent),
  venueDraft: async (body) => json(await post("/api/venues/draft", body)),
  people: async () => (await json<{ people: PersonRow[] }>(await safeFetch("/api/people"))).people,
  person: async (id) => json(await safeFetch(`/api/people/${encodeURIComponent(id)}`)),
  editPerson: async (id, patch) =>
    (
      await json<{ person: Person }>(
        await safeFetch(`/api/people/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }),
      )
    ).person,
  archive: async () => (await json<{ rows: ArchiveRow[] }>(await safeFetch("/api/archive"))).rows,
  voices: async () => (await json<{ voices: SurveyVoice[] }>(await safeFetch("/api/voices"))).voices,
  unassigned: async () => (await json<{ cards: UnassignedCard[] }>(await safeFetch("/api/unassigned-cards"))).cards,
  assignUnassigned: async (card_id, employee_id) => json(await post("/api/unassigned-cards/assign", { card_id, employee_id })),
  archiveDetail: async (kind, id) => json(await safeFetch(`/api/archive/${kind}/${encodeURIComponent(id)}`)),
};

export function pickApi(): Api {
  if (typeof window === "undefined") return realApi;
  return new URLSearchParams(window.location.search).has("mock") ? mockApi(realApi) : realApi;
}
