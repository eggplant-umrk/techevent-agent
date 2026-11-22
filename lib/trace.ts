// 実行の記録（Langfuse の簡易版）：依頼ごとに、何を・どれだけの時間・いくらで・成功したかを data/runtime/traces/{依頼のid}.json に残す。
// - 残すのは名前・時間・数・成否だけ。指示文や会話の原文、ツールの入力・結果、API キーは残さない
// - 記録の範囲は withTrace(依頼のid, …) の中（AsyncLocalStorage）。外（評価スクリプトなど）では何もしない
// - 同じ依頼をもう一度探したり下書きを作ったりしたら、同じファイルに足していく（依頼1件にかかった合計が分かるように）
// - 読む関数：listTraces（一覧）・getTrace（1件）・requestCostUsd（依頼1件の合計金額）。画面は①が作る
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import type { AgentEvent } from "./agent";
import { nowJst } from "./clock";
import { readJsonSafe, writeJsonAtomic } from "./fileStore";
import { costUsd } from "./pricing";
import { runtimeRoot } from "./runtime";
import { scopedFile } from "./visitorScope";

export type TraceStepKind = "llm" | "tool" | "code";

export interface TraceStep {
  kind: TraceStepKind;
  /** llm：使い道（loop・inbox_extract・draft など。分からなければモデル名）／tool：ツールの名前／code：コードでした処理の名前 */
  name: string;
  /** llm のときだけ：モデル名 */
  model?: string;
  started_at: string;
  ms: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  ok: boolean;
  /** 失敗の種類だけ（timeout・429・529 など）。エラーの本文は残さない */
  error?: string;
}

export interface Trace {
  request_id: string;
  started_at: string;
  steps: TraceStep[];
  /** 記録した処理（候補づくり・下書きなど）それぞれの所要時間の合計 */
  total_ms: number;
  total_cost_usd: number;
}

/** 記録の置き場所（data/runtime/traces/。テスト・評価は DATA_RUNTIME_DIR の中） */
export const tracesDir = () => scopedFile(path.join(runtimeRoot(), "traces")); // 見せる用では今の人の場所
/** 依頼の id をファイル名に使えるようにする（英数字・-・_ 以外は _ に） */
const safeId = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
export const traceFile = (requestId: string) => path.join(tracesDir(), `${safeId(requestId)}.json`);

const isTrace = (v: unknown) => !!v && typeof v === "object" && Array.isArray((v as Trace).steps) && typeof (v as Trace).request_id === "string";

interface Ctx {
  trace: Trace;
  /** ツールの呼び出し中（id → 始めた時刻） */
  open: Map<string, { name: string; kind: TraceStepKind; t0: number; at: string }>;
}
const als = new AsyncLocalStorage<Ctx>();

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function save(ctx: Ctx) {
  const t = ctx.trace;
  t.total_cost_usd = round6(t.steps.reduce((s, x) => s + (x.cost_usd ?? 0), 0));
  try {
    writeJsonAtomic(traceFile(t.request_id), t);
  } catch (e) {
    // 記録に失敗しても、依頼の処理は止めない
    console.error(`[実行の記録] 保存できませんでした（${e instanceof Error ? e.message : "不明なエラー"}）`);
  }
}

/** fn の中で起きた API の呼び出し・ツール・コードの処理を、依頼 requestId の記録に足す */
export async function withTrace<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  if (als.getStore()?.trace.request_id === requestId) return fn(); // すでに同じ依頼の記録の中
  const prev = readJsonSafe<Trace | null>(traceFile(requestId), null, isTrace);
  const ctx: Ctx = {
    trace: prev ?? { request_id: requestId, started_at: nowJst(), steps: [], total_ms: 0, total_cost_usd: 0 },
    open: new Map(),
  };
  const t0 = Date.now();
  try {
    return await als.run(ctx, fn);
  } finally {
    ctx.trace.total_ms += Date.now() - t0;
    save(ctx);
  }
}

function push(step: TraceStep) {
  const ctx = als.getStore();
  if (!ctx) return;
  ctx.trace.steps.push(step);
  save(ctx); // 途中で止まっても、そこまでの記録は残る
}

/** 失敗の種類だけを取り出す（本文は残さない） */
export function errorKind(err: unknown): string {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return String(status);
  const name = err instanceof Error ? err.name : "";
  if (/Timeout/i.test(name)) return "timeout";
  if (/Abort/i.test(name)) return "aborted";
  if (/Connection/i.test(name)) return "connection";
  return name && name !== "Error" ? name : "error";
}

// ---------------------------------------------------------------------------
// API の呼び出し（lib/anthropic.ts から呼ぶ）
// ---------------------------------------------------------------------------
type ApiUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };

/** API の呼び出し1回を記録する。名前（使い道）は、あとで recordUsage が付ける（traceUsagePurpose） */
export function traceLlm(model: string, startedAt: string, ms: number, res: unknown, err?: unknown) {
  if (!als.getStore()) return;
  if (err !== undefined) {
    push({ kind: "llm", name: model, model, started_at: startedAt, ms, ok: false, error: errorKind(err) });
    return;
  }
  const u = ((res as { usage?: ApiUsage })?.usage ?? {}) as ApiUsage;
  const t = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 };
  const m = String((res as { model?: unknown })?.model ?? "") || model; // 返事のモデル名（金額の記録と同じ名前）
  push({
    kind: "llm",
    name: m,
    model: m,
    started_at: startedAt,
    ms,
    input_tokens: t.input + t.cacheRead + t.cacheWrite,
    output_tokens: t.output,
    cost_usd: round6(costUsd(model, t)),
    ok: true,
  });
}

/** recordUsage（lib/usage.ts）から：まだ名前が付いていない、同じモデル・同じ出力の数の直近の呼び出しに、使い道の名前を付ける */
export function traceUsagePurpose(purpose: string, model: string, outputTokens: number) {
  const ctx = als.getStore();
  if (!ctx) return;
  for (let i = ctx.trace.steps.length - 1; i >= 0; i--) {
    const s = ctx.trace.steps[i];
    if (s.kind === "llm" && s.ok && s.name === model && s.model === model && s.output_tokens === outputTokens) {
      s.name = purpose;
      save(ctx);
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// ツール・コードの処理（作業ログの流れから時間を測る）
// ---------------------------------------------------------------------------
/** 作業ログを流す関数を包んで、ツールの呼び出し（tool_call → tool_result）の時間と成否を記録する。中身は残さない */
export function traceEmit(emit: (e: AgentEvent) => void): (e: AgentEvent) => void {
  return (e) => {
    const ctx = als.getStore();
    if (ctx && e.type === "tool_call") {
      const byCode = e.id === "prefetch" || (e.input as { by?: unknown } | null)?.by === "code";
      ctx.open.set(e.id, { name: e.name, kind: byCode ? "code" : "tool", t0: Date.now(), at: nowJst() });
    } else if (ctx && e.type === "tool_result") {
      const o = ctx.open.get(e.id);
      ctx.open.delete(e.id);
      push({ kind: o?.kind ?? "tool", name: e.name, started_at: o?.at ?? nowJst(), ms: o ? Date.now() - o.t0 : 0, ok: e.ok, ...(e.ok ? {} : { error: "failed" }) });
    }
    emit(e);
  };
}

/** コードでする処理を、名前・時間・成否だけ記録しながら動かす */
export async function traceCode<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  if (!als.getStore()) return fn();
  const at = nowJst();
  const t0 = Date.now();
  try {
    const v = await fn();
    push({ kind: "code", name, started_at: at, ms: Date.now() - t0, ok: true });
    return v;
  } catch (e) {
    push({ kind: "code", name, started_at: at, ms: Date.now() - t0, ok: false, error: errorKind(e) });
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 読む
// ---------------------------------------------------------------------------
/** 1件（なければ null）。壊れていたら退けて null（落とさない） */
export function getTrace(requestId: string): Trace | null {
  return readJsonSafe<Trace | null>(traceFile(requestId), null, isTrace);
}

/** 一覧（新しく始めた順）。steps は数だけにした軽い形 */
export function listTraces(): Array<Omit<Trace, "steps"> & { step_count: number; llm_calls: number; failed_steps: number }> {
  let names: string[] = [];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ tracesDir()).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const t = readJsonSafe<Trace | null>(path.join(tracesDir(), n), null, isTrace);
    if (!t) continue;
    const { steps, ...rest } = t;
    out.push({ ...rest, step_count: steps.length, llm_calls: steps.filter((s) => s.kind === "llm").length, failed_steps: steps.filter((s) => !s.ok).length });
  }
  return out.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

/** 依頼1件の合計金額（実行の記録から。記録がなければ null）。受信箱の1件は item.id で引く */
export function requestCostUsd(requestId: string): number | null {
  const t = getTrace(requestId);
  return t ? t.total_cost_usd : null;
}
