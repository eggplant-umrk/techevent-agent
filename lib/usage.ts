import type Anthropic from "@anthropic-ai/sdk";
import { nowJst } from "./clock";
import { appendUsage, usage, type UsageEntry } from "./data";
import { costUsd } from "./pricing";
import { traceUsagePurpose } from "./trace";
import { envConfig, SWITCH_HEAVY_MODEL, SWITCH_LOOP_MODEL } from "./config";

type AnyUsage = Pick<
  Anthropic.Usage,
  "input_tokens" | "output_tokens" | "cache_read_input_tokens" | "cache_creation_input_tokens"
>;

export function recordUsage(runId: string, purpose: UsageEntry["purpose"], model: string, u: AnyUsage): UsageEntry {
  const t = {
    input: u.input_tokens ?? 0,
    output: u.output_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
  };
  const entry: UsageEntry = {
    at: nowJst(),
    run_id: runId,
    purpose,
    model,
    input_tokens: t.input,
    output_tokens: t.output,
    cache_read_input_tokens: t.cacheRead,
    cache_creation_input_tokens: t.cacheWrite,
    cost_usd: costUsd(model, t),
  };
  appendUsage(entry);
  traceUsagePurpose(purpose, model, t.output); // 実行の記録の、直近の呼び出しに使い道の名前を付ける
  return entry;
}

export function totalUsd(): number {
  return usage().reduce((s, e) => s + e.cost_usd, 0);
}

export function runUsd(runId: string): number {
  return usage()
    .filter((e) => e.run_id === runId)
    .reduce((s, e) => s + e.cost_usd, 0);
}

export interface ModelChoice {
  loop: string;
  heavy: string;
  switched: boolean;
  totalUsd: number;
  switchUsd: number;
}

/** Above USAGE_SWITCH_USD the loop drops to Sonnet and heavy work drops to Opus. */
export function chooseModels(): ModelChoice {
  const cfg = envConfig();
  const total = totalUsd();
  const switched = total > cfg.switchUsd;
  return {
    loop: switched ? SWITCH_LOOP_MODEL : cfg.agentModel,
    heavy: switched ? SWITCH_HEAVY_MODEL : cfg.heavyModel,
    switched,
    totalUsd: total,
    switchUsd: cfg.switchUsd,
  };
}
