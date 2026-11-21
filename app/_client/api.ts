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
  InboxDetail,
  InboxListItem,
  ModelChoice,
  NotebookCard,
  NotebookEvent,
  OutcomeBody,
  OutreachDraft,
  SpeakingRequest,
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
  state(): Promise<{ models: ModelChoice; pending_employees: number }>;
  requests(): Promise<SpeakingRequest[]>;
  runAgent(body: { request_id: string; custom_text?: string }, onEvent: (e: AgentEvent) => void): Promise<void>;
  updateNotebook(onEvent: (e: NotebookEvent) => void): Promise<void>;
  blogIdeas(): Promise<{ ideas: BlogIdea[]; run_usd: number; total_usd: number }>;
  draft(body: DraftBody): Promise<DraftResponse>;
  outcome(body: OutcomeBody): Promise<Card>;
  editCard(cardId: string, patch: CardPatch): Promise<void>;
  resolvePending(cardId: string, theme: string, accept: boolean): Promise<void>;
  /** 受信箱の一覧（新しい順） */
  inbox(): Promise<InboxListItem[]>;
  /** 手で追加（受信箱に入る入口の1つ） */
  inboxAdd(text: string): Promise<{ id: string }>;
  /** 受信箱の1件（保存した候補と作業ログつき） */
  inboxDetail(id: string): Promise<InboxDetail>;
  /** 開いた印を付ける */
  inboxOpen(id: string): Promise<void>;
}

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
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const realApi: Api = {
  mock: false,
  cards: () => fetch("/api/cards").then(json<{ cards: NotebookCard[]; units: string[] }>),
  state: () => fetch("/api/state").then(json<{ models: ModelChoice; pending_employees: number }>),
  requests: () => fetch("/api/requests").then(json<SpeakingRequest[]>),
  runAgent: async (body, onEvent) => readNdjson(await post("/api/agent", body), onEvent),
  updateNotebook: async (onEvent) => readNdjson(await post("/api/notebook"), onEvent),
  blogIdeas: async () => json(await post("/api/blog-ideas")),
  draft: async (body) => json(await post("/api/draft", body)),
  outcome: async (body) => (await json<{ card: Card }>(await post("/api/outcome", body))).card,
  editCard: async (card_id, patch) => {
    await json(await fetch("/api/cards", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ card_id, patch }) }));
  },
  resolvePending: async (card_id, theme, accept) => {
    await json(await post("/api/cards/pending", { card_id, theme, accept }));
  },
  inbox: async () => (await json<{ items: InboxListItem[] }>(await fetch("/api/inbox"))).items,
  inboxAdd: async (text) => json(await post("/api/inbox", { text, source: "manual" })),
  inboxDetail: async (id) => json(await fetch(`/api/inbox/${encodeURIComponent(id)}/detail`)),
  inboxOpen: async (id) => {
    await json(await post(`/api/inbox/${encodeURIComponent(id)}/open`));
  },
};

export function pickApi(): Api {
  if (typeof window === "undefined") return realApi;
  return new URLSearchParams(window.location.search).has("mock") ? mockApi(realApi) : realApi;
}
