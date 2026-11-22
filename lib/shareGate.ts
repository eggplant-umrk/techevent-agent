// 見せる用（SHARE_MODE=lan）の API 代の上限を、まとめて確かめる（合計 → 側ごと → 1人あたり。どれも見せる用を起動してからの分）。
//   - 入口（proxy.ts）で見るのに加えて、API を使う窓口が同時実行の枠を取った直後にもう一度見る（afterSlot）。
//     枠を待っている間にほかの人の操作で上限に届いていたら、始めずに 429 で返す（入口を通ったあとに超えるのを防ぐ）
//   - 発表用では何もしない
import { usage } from "./data";
import { checkPerson, checkPool, roleOf, visitorKeyOf } from "./personBudget";
import { checkBudget, shareBudgetUsd, shareMode, shareStartedAt, spentSince } from "./share";

export type Gate = { ok: true } | { ok: false; status: number; error: string };

/** その要求の人で、合計・側ごと・1人あたりの上限を確かめる。key を渡せばその人（入口で人の印を付けたばかりのとき） */
export function shareBudgetGate(req: Pick<Request, "headers" | "method" | "url">, key = visitorKeyOf(req)): Gate {
  if (shareMode() !== "lan") return { ok: true };
  if (shareBudgetUsd() !== null) {
    const pathname = new URL(req.url).pathname;
    const budget = checkBudget(req.method, pathname, spentSince(usage(), shareStartedAt()));
    if (!budget.ok) return budget;
  }
  const role = roleOf(req);
  const pool = checkPool(role);
  if (!pool.ok) return pool;
  return checkPerson(key, role);
}

/**
 * 同時実行の枠を取ったあとに包む（perPerson(slotted(afterSlot(handlePost))) の順）。
 * 枠を取った直後にもう一度上限を見て、超えていたら始めない（枠は slotted が返す）
 */
export function afterSlot<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    const req = args[0];
    if (shareMode() === "lan" && req instanceof Request) {
      const g = shareBudgetGate(req);
      if (!g.ok) return Response.json({ error: g.error }, { status: g.status });
    }
    return fn(...args);
  };
}
