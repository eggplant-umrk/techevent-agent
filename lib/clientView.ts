// 画面に返す形を、見せる用（SHARE_MODE=lan）向けに整える。
//   見せる用では、API 代の合計（total_usd・models.totalUsd）を返さない（会場の参加者に、発表全体の金額を見せない）。
//   その操作の金額（run_usd）と、その人の残り（/api/state の share）は返してよい。発表用ではそのまま返す
import { shareMode } from "./share";

const HIDDEN = new Set(["total_usd", "totalUsd"]);

/** 見せる用なら、total_usd・totalUsd をどの深さからも外した写しを返す */
export function forClient<T>(value: T): T {
  if (shareMode() !== "lan" || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value, (k, v) => (HIDDEN.has(k) ? undefined : v))) as T;
}
