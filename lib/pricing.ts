// Price table (USD per 1M tokens). Edit here only.
// cacheWrite is not in the spec; it uses the API's 5-minute cache write rate (1.25x input).
export const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-fable-5-2": { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};

export interface TokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Returns USD. Unknown models are priced as the most expensive known model so cost is never under-reported. */
export function costUsd(model: string, t: TokenCounts): number {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  const p = key ? PRICING[key] : PRICING["claude-fable-5-2"];
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead + t.cacheWrite * p.cacheWrite) / 1_000_000;
}
