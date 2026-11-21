import Anthropic from "@anthropic-ai/sdk";

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
    const ms = apiTimeoutMs();
    const deadline = AbortSignal.timeout(ms);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
    return original(body, { ...opts, signal }).catch((e: unknown) => {
      if (deadline.aborted && !opts?.signal?.aborted) throw new ApiTimeoutError(ms);
      throw e;
    });
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
