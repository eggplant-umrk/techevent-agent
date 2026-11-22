import Anthropic from "@anthropic-ai/sdk";
import { usageProblem } from "./usageFile";
import { nowJst } from "./clock";
import { traceLlm } from "./trace";

let client: Anthropic | null = null;

/**
 * API の呼び出し1回（SDK の自動のやり直しを含む）の時間切れ。既定は90秒（.env の API_TIMEOUT_MS で変えられる）。
 * SDK の既定（10分・時間切れもやり直す）のままだと、返事をしない API に同時実行の枠を長く取られるため。
 * これまでの記録で、ふつうの呼び出しの最長は約66秒（下書き）。
 */
export function apiTimeoutMs(): number {
  const n = Number((process.env.API_TIMEOUT_MS ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : 90_000;
}

/** 時間切れで止めた呼び出しのエラー（使う人向けの文） */
export class ApiTimeoutError extends Error {
  constructor(ms: number) {
    super(`AI の返事が${Math.round(ms / 1000)}秒なかったので止めました`);
    this.name = "ApiTimeoutError";
  }
}

type Create = (body: unknown, opts?: { signal?: AbortSignal | null } & Record<string, unknown>) => Promise<unknown>;

/** create を、呼び出しごとに時間切れの付いたものに差し替える（時間切れで止めたらやり直さない） */
function withDeadline(target: { create: Create }) {
  const original = target.create.bind(target);
  target.create = (body, opts) => {
    // 金額の記録が読めない間は呼ばない（上限を守れないため。窓口の apiSlots でも止めているが、スクリプトから呼ばれたときの備え）
    const problem = usageProblem();
    if (problem) return Promise.reject(new Error(problem));
    const ms = apiTimeoutMs();
    const deadline = AbortSignal.timeout(ms);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
    // 実行の記録（lib/trace.ts）：モデル名・時間・数・成否だけ。指示文や返事の中身は渡さない
    const model = String((body as { model?: unknown })?.model ?? "");
    const at = nowJst();
    const t0 = Date.now();
    return original(body, { ...opts, signal }).then(
      (res) => {
        traceLlm(model, at, Date.now() - t0, res);
        return res;
      },
      (e: unknown) => {
        const err = deadline.aborted && !opts?.signal?.aborted ? new ApiTimeoutError(ms) : e;
        traceLlm(model, at, Date.now() - t0, undefined, err);
        throw err;
      },
    );
  };
}

/** Server-side client. The key comes from .env via process.env and is never sent to the browser or logged. */
export function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY が .env にありません");
    const c = new Anthropic({ apiKey, timeout: apiTimeoutMs() });
    withDeadline(c.messages as unknown as { create: Create });
    withDeadline(c.beta.messages as unknown as { create: Create });
    client = c;
  }
  return client;
}
