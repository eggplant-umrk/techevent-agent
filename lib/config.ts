// Shared constants. Server-only values (API key, model names) are read from
// process.env, which Next.js fills from .env on the server. Nothing here is
// exposed to the browser.

/** The demo's "today". Fixed so the system prompt stays byte-identical (prompt cache). */
export const TODAY = "2026-11-21";

/** Agent loop: maximum number of model calls per proposal. */
export const MAX_STEPS = 15;

/** Tool results are kept short to save tokens. */
export const SEARCH_LIMIT = 10;
export const BODY_CHARS = 200;

/** Current topics the agent can lean on when proposing a theme (時流). */
export const TRENDS = [
  "AIエージェントの本番運用と評価",
  "サプライチェーンセキュリティ・脆弱性管理の自動化",
  "生成AIを使った開発生産性",
  "障害対応・ポストモーテムの文化",
  "Webパフォーマンスとアクセシビリティ",
];

export const SWITCH_LOOP_MODEL = "claude-sonnet-5-5";
export const SWITCH_HEAVY_MODEL = "claude-opus-5-5";
/** Used when the heavy model call fails. */
export const HEAVY_FALLBACK_MODEL = "claude-opus-5-5";

export function envConfig() {
  return {
    agentModel: process.env.AGENT_MODEL || "claude-opus-5-5",
    heavyModel: process.env.HEAVY_MODEL || "claude-fable-5-2",
    switchUsd: Number(process.env.USAGE_SWITCH_USD || "150"),
  };
}
