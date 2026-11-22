// 金額の記録（data/usage.json）の置き場所と、読めなかったときの扱い。
// 金額の記録が壊れたときに「0ドルから数え直し」にすると、API 代の上限が効かなくなる。
// そのため、壊れたファイルを退けたあとも（サーバーを起動し直しても）、退けたファイルが残っている間は API を使う操作を止める。
// 人が中身を確かめて、退けたファイル（usage.json.broken-…）を片付けたら、また使えるようになる。
import path from "node:path";
import { dataFile } from "./dataSource";
import { brokenCopies, readJsonSafe } from "./fileStore";

/** 金額の記録の場所。テストでは USAGE_FILE で一時ファイルに向ける（本物の記録を汚さない） */
export function usageFilePath(): string {
  return process.env.USAGE_FILE || dataFile("usage.json");
}

/** 1件の記録の形（金額が数でなければ、合計が NaN になって上限が効かないので、壊れているとみなす） */
export function usageShapeOk(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.every((e) => !!e && typeof e === "object" && typeof (e as { cost_usd?: unknown }).cost_usd === "number" && Number.isFinite((e as { cost_usd: number }).cost_usd))
  );
}

/** 金額の記録が読めない（退けた壊れたファイルが残っている）なら、使う人向けの理由。問題なければ null */
export function usageProblem(): string | null {
  // まだ誰も読んでいない壊れた記録にも気づけるように、先に1回読む（壊れていれば、ここで退ける）
  readJsonSafe<unknown[]>(usageFilePath(), [], usageShapeOk);
  const broken = brokenCopies(usageFilePath());
  if (!broken.length) return null;
  const name = path.basename(broken[broken.length - 1]);
  return `金額の記録が読めません（壊れていたので ${name} に退けました）。API 代の上限を守れないので、API を使う操作は止めています。中身を確かめてから退けたファイルを片付けると、また使えます`;
}
