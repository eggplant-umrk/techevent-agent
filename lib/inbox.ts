// 受信箱：届いた依頼を登録し、裏で候補づくり（既存の runAgent）を自動で始める。
// 状態は processing（準備中）→ ready（準備済み）／error（エラー）。
// 依頼は既存の依頼と同じ形（SpeakingRequest）に変換して流すので、承認・下書き・書き戻しはそのまま使える。
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentEvent, ProposalResult } from "./agent";
import type { SpeakingRequest } from "./data";
import { internalTerms } from "./plainText";

/** 書き込み先。テストでは INBOX_FILE で別のファイルに向ける */
const FILE = () => process.env.INBOX_FILE || path.join(process.cwd(), "data", "inbox.json");
/** 準備中のまま、これより長く経ったものは中断とみなす（サーバーの再起動など） */
const STALE_MS = 15 * 60 * 1000;
const MAX_TEXT = 4000;

export type InboxSource = "slack" | "manual";
export type InboxStatus = "processing" | "ready" | "error";

export interface InboxMeta {
  channel?: string;
  ts?: string;
  user?: string;
  permalink?: string;
}

export interface InboxItem {
  id: string;
  source: InboxSource;
  meta: InboxMeta | null;
  text: string;
  received_at: string;
  status: InboxStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  /** 画面で一度でも開いたか（「新しい依頼」の印に使う） */
  opened_at: string | null;
  result: ProposalResult | null;
  /** 作業ログ（画面の「Agentがやったこと」を再現するため） */
  events: AgentEvent[];
  run_usd: number;
}

export type Runner = (request: SpeakingRequest, emit: (e: AgentEvent) => void) => Promise<ProposalResult | null>;

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------
function load(): InboxItem[] {
  const f = FILE();
  if (!fs.existsSync(/*turbopackIgnore: true*/ f)) return [];
  return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ f, "utf-8")) as InboxItem[];
}

function save(items: InboxItem[]) {
  fs.writeFileSync(/*turbopackIgnore: true*/ FILE(), JSON.stringify(items, null, 2) + "\n", "utf-8");
}

/** 1件を書き換える。読み込みから書き込みまで同期なので、同じプロセス内で割り込まれない */
function update(id: string, fn: (it: InboxItem) => InboxItem) {
  const items = load();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return;
  items[i] = fn(items[i]);
  save(items);
}

function withStale(it: InboxItem): InboxItem {
  if (it.status === "processing" && Date.now() - Date.parse(it.started_at) > STALE_MS) {
    return { ...it, status: "error", error: "候補づくりが途中で止まりました（サーバーの再起動など）。もう一度探してください。" };
  }
  return it;
}

export function listInbox(): InboxItem[] {
  return load()
    .map(withStale)
    .sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
}

export function getInboxItem(id: string): InboxItem | undefined {
  const it = load().find((x) => x.id === id);
  return it ? withStale(it) : undefined;
}

export function markOpened(id: string) {
  update(id, (it) => (it.opened_at ? it : { ...it, opened_at: new Date().toISOString() }));
}

// ---------------------------------------------------------------------------
// 既存の依頼の形にする
// ---------------------------------------------------------------------------
/** 受信箱の依頼を、既存の依頼（SpeakingRequest）と同じ形にする。開催日などは本文からAgentが読み取る */
export function inboxRequest(it: Pick<InboxItem, "id" | "text" | "received_at" | "source">): SpeakingRequest {
  return { id: it.id, received_at: it.received_at.slice(0, 10), message: it.text };
}

// ---------------------------------------------------------------------------
// 受け取る
// ---------------------------------------------------------------------------
export interface InboxInput {
  text: string;
  source: InboxSource;
  meta?: InboxMeta;
}

/** 窓口の入力を確かめる。問題があればエラー文、なければ整えた入力を返す */
export function parseInboxInput(body: unknown): { ok: true; input: InboxInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "JSON の本文がありません" };
  const b = body as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { ok: false, error: "text が空です" };
  if (text.length > MAX_TEXT) return { ok: false, error: `text は ${MAX_TEXT} 文字までです` };
  if (b.source !== "slack" && b.source !== "manual") return { ok: false, error: 'source は "slack" か "manual" です' };
  let meta: InboxMeta | undefined;
  if (b.meta !== undefined && b.meta !== null) {
    if (typeof b.meta !== "object") return { ok: false, error: "meta はオブジェクトです" };
    const m = b.meta as Record<string, unknown>;
    meta = {};
    for (const k of ["channel", "ts", "user", "permalink"] as const) {
      if (m[k] === undefined) continue;
      if (typeof m[k] !== "string") return { ok: false, error: `meta.${k} は文字列です` };
      meta[k] = (m[k] as string).slice(0, 500);
    }
  }
  return { ok: true, input: { text, source: b.source, meta } };
}

const newId = () => `inb-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

/** 登録して、裏で候補づくりを始める。返すのは登録した1件（まだ processing） */
export function addToInbox(input: InboxInput, runner: Runner): InboxItem {
  const now = new Date().toISOString();
  const item: InboxItem = {
    id: newId(),
    source: input.source,
    meta: input.meta ?? null,
    text: input.text,
    received_at: now,
    status: "processing",
    started_at: now,
    finished_at: null,
    error: null,
    opened_at: null,
    result: null,
    events: [],
    run_usd: 0,
  };
  save([...load(), item]);
  void prepare(item.id, runner);
  return item;
}

/** 候補づくり。終わったら結果と作業ログを保存する（テストから待てるように Promise を返す） */
export async function prepare(id: string, runner: Runner): Promise<void> {
  const it = getInboxItem(id);
  if (!it) return;
  const events: AgentEvent[] = [];
  let runUsd = 0;
  try {
    const result = await runner(inboxRequest(it), (e) => {
      events.push(e);
      if (e.type === "done") runUsd = e.run_usd;
    });
    const failed = events.find((e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error");
    update(id, (x) => ({
      ...x,
      status: result ? "ready" : "error",
      error: result ? null : failed?.message ?? "候補を出せませんでした",
      result,
      events,
      run_usd: runUsd,
      finished_at: new Date().toISOString(),
    }));
  } catch (err) {
    update(id, (x) => ({
      ...x,
      status: "error",
      error: err instanceof Error ? err.message : "候補を出せませんでした",
      events,
      run_usd: runUsd,
      finished_at: new Date().toISOString(),
    }));
  }
}

/** もう一度探す（画面の「もう一度探す」とは別に、エラーの依頼を準備し直すとき用） */
export function restart(id: string, runner: Runner) {
  update(id, (x) => ({ ...x, status: "processing", started_at: new Date().toISOString(), finished_at: null, error: null }));
  void prepare(id, runner);
}

// ---------------------------------------------------------------------------
// 窓口（GET /api/inbox/{id}）の返す形
// ---------------------------------------------------------------------------
const FALLBACK = "理由は画面で確認してください";

/** 先頭の1文（長ければ60字で切る） */
function shorten(s: string): string {
  const first = s.split(/(?<=。)/)[0]?.trim() ?? "";
  return first.length > 60 ? first.slice(0, 59) + "…" : first;
}

/** 内部の言葉が入っていたら使わない（lib/plainText.ts の判定） */
const plain = (s: string | null | undefined) => !!s && internalTerms(s).length === 0;

export interface InboxSummary {
  candidates: Array<{ name: string; confidence: "strong" | "conditional"; reason_short: string }>;
  no_fit?: { reasons: string[] };
}

export function summaryOf(it: InboxItem): InboxSummary | undefined {
  if (it.status !== "ready" || !it.result) return undefined;
  const candidates = it.result.candidates.map((c) => {
    const short = shorten(c.reason);
    return {
      name: c.name,
      confidence: c.confidence,
      reason_short: plain(short) ? short : plain(c.theme) ? shorten(c.theme) : FALLBACK,
    };
  });
  const summary: InboxSummary = { candidates };
  if (it.result.no_fit) {
    const reasons = it.result.no_fit.reasons.filter((r) => plain(r));
    summary.no_fit = { reasons: reasons.length ? reasons : [FALLBACK] };
  }
  return summary;
}

/** 窓口の返す形（docs/inbox-api.md と同じ。形は変えない） */
export function publicView(it: InboxItem, origin: string) {
  const summary = summaryOf(it);
  return {
    id: it.id,
    status: it.status,
    ...(summary ? { summary } : {}),
    url: `${origin}/?inbox=${encodeURIComponent(it.id)}`,
  };
}

// ---------------------------------------------------------------------------
// 画面用
// ---------------------------------------------------------------------------
export interface InboxListItem {
  id: string;
  source: InboxSource;
  status: InboxStatus;
  received_at: string;
  is_new: boolean;
  /** 本文の先頭（一覧に出す） */
  title: string;
  candidate_names: string[];
  no_fit: boolean;
  error: string | null;
  permalink: string | null;
}

export function listView(it: InboxItem): InboxListItem {
  const firstLine = it.text.split(/\r?\n/).find((l) => l.trim()) ?? it.text;
  return {
    id: it.id,
    source: it.source,
    status: it.status,
    received_at: it.received_at,
    is_new: !it.opened_at,
    title: firstLine.length > 70 ? firstLine.slice(0, 69) + "…" : firstLine,
    candidate_names: it.result?.candidates.map((c) => c.name) ?? [],
    no_fit: !!it.result && it.result.candidates.length === 0,
    error: it.status === "error" ? it.error : null,
    permalink: it.meta?.permalink ?? null,
  };
}

export interface InboxDetail extends InboxListItem {
  text: string;
  result: ProposalResult | null;
  events: AgentEvent[];
  run_usd: number;
}

export function detailView(it: InboxItem): InboxDetail {
  return { ...listView(it), text: it.text, result: it.result, events: it.events, run_usd: it.run_usd };
}
