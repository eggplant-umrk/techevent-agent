// 見せる用（SHARE_MODE=lan）の、1人あたりの API 代の上限（SHARE_PER_PERSON_USD）。
//   - 「1人」＝合言葉で入ったブラウザ。入ったときに人ごとの印（cookie nb_person、ランダムな値）を付ける
//     （合言葉の印 nb_access は全員同じ値なので、人を分けるのに使えない）
//   - 使った API 代は、人ごとの印のハッシュで data/runtime-share/person_usage.json に足していく（印の値そのものは保存しない）
//   - 数え方：API を使う窓口を perPerson() で包み、その中（裏で続く候補づくりも含む）で記録した金額を、その人に足す（AsyncLocalStorage）
//   - 上限を超えたら、その人だけ API を使う操作を止める（入口 proxy.ts で 429）。合計の上限 SHARE_BUDGET_USD はそのまま
//     （印を消せば数え直せてしまうため、合計の上限で守る）
//   - 発表用（SHARE_MODE が lan でない）では何もしない
//   - 人の見分け方（印の名前・ハッシュ）は③の lib/visitor.ts を使う。ここの名前はその別名（呼ぶ側を変えないため）
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { readJsonSafe, writeJsonAtomic } from "./fileStore";
import { MENTOR_COOKIE, mentorCode, mentorToken, shareMode, shareStartedAt } from "./share";
import { shareBaseDir } from "./visitorScope";
import { NO_VISITOR, newVisitorId, VISITOR_COOKIE, visitorCookieHeader, visitorCookieOf, visitorKey, visitorKeyOf } from "./visitor";

export const PERSON_COOKIE = VISITOR_COOKIE;
export const PERSON_LIMIT_MESSAGE = "この端末で試せる分を使い切りました。保存済みの例（?mock）は引き続き見られます";
/** 合言葉をヘッダー（X-Access-Code）で送るスクリプトなど、人の印がない要求をまとめて数える名前 */
export const NO_PERSON = NO_VISITOR;

/** 役割：メンター用の合言葉（MENTOR_ACCESS_CODE）で入った人は mentor。画面の見た目は変えない */
export type VisitorRole = "mentor" | "general";

const usdEnv = (name: string): number | null => {
  const raw = (process.env[name] ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * 1人あたりの上限（ドル）。見せる用で設定があるときだけ。なければ null（人ごとには止めない）。
 * メンターは SHARE_MENTOR_USD（なければ一般と同じ SHARE_PER_PERSON_USD）、一般は SHARE_PER_PERSON_USD
 */
export function perPersonUsd(role: VisitorRole = "general"): number | null {
  if (shareMode() !== "lan") return null;
  if (role === "mentor") return usdEnv("SHARE_MENTOR_USD") ?? usdEnv("SHARE_PER_PERSON_USD");
  return usdEnv("SHARE_PER_PERSON_USD");
}

/** 要求の役割：見せる用で、メンターの印（cookie nb_role）が今のメンター用の合言葉から作った値と同じなら mentor。発表用は常に general */
export function roleOf(req: Pick<Request, "headers">): VisitorRole {
  if (shareMode() !== "lan" || !mentorCode()) return "general";
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === MENTOR_COOKIE && v.join("=") === mentorToken()) return "mentor";
  }
  return "general";
}

/** メンターの印の cookie（httpOnly・12時間）。値は合言葉から作ったハッシュで、合言葉そのものは入れない */
export const mentorCookieHeader = () => `${MENTOR_COOKIE}=${mentorToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 12}`;

/** 設定の問題（数でない・0以下）。なければ null */
export function perPersonConfigProblem(): string | null {
  const raw = (process.env.SHARE_PER_PERSON_USD ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? null : `SHARE_PER_PERSON_USD は 0 より大きい数にしてください（例：5）。今は「${raw.slice(0, 20)}」です`;
}

/** 新しい人の印（ランダム）・印の値 → 保存に使う名前（ハッシュ）・Cookie ヘッダーから人の印・人の印の cookie（lib/visitor.ts） */
export const newPersonId = newVisitorId;
export const personKey = visitorKey;
export const personCookieOf = visitorCookieOf;
export const personCookieHeader = visitorCookieHeader;
/** 要求がどの人からか（保存に使う名前）。③の lib/visitor.ts の visitorKeyOf そのもの */
export { visitorKeyOf };

// ---- 人ごとの金額の記録 ----------------------------------------------------------------------

/** usd：その人が使った合計。mentor_usd：そのうちメンターとして使った分（側ごとの上限を数えるため） */
type Ledger = Record<string, { usd: number; calls: number; last_at: string; role?: "mentor"; mentor_usd?: number }>;
/**
 * 台帳のファイルの形：見せる用を起動した時刻（started_at）と、人ごとの金額（people）。
 * 起動の時刻が今の見せる用と違えば（起動し直した・前の形のファイル）、空として数える。
 * 合計の上限（SHARE_BUDGET_USD）と同じく、1人あたり・側ごとの上限も「見せる用を起動してからの分」で数えるため
 */
interface LedgerFile {
  started_at: string;
  people: Ledger;
}
/** 全員分を1つのファイルで持つので、人ごとに分ける前の見せる用の置き場（③の lib/visitorScope.ts の shareBaseDir()）に置く */
export const personUsageFile = () => path.join(shareBaseDir(), "person_usage.json");
function readLedger(): Ledger {
  const f = readJsonSafe<Partial<LedgerFile>>(personUsageFile(), {}, "object");
  return f.started_at === shareStartedAt() && f.people && typeof f.people === "object" ? f.people : {};
}
const writeLedger = (people: Ledger) => writeJsonAtomic(personUsageFile(), { started_at: shareStartedAt(), people } satisfies LedgerFile);

/** その人が使った金額 */
export const personSpent = (key: string): number => readLedger()[key]?.usd ?? 0;

/** その人の残り（上限がなければ null） */
export function personRemaining(key: string, role: VisitorRole = "general"): number | null {
  const limit = perPersonUsd(role);
  return limit === null ? null : Math.max(0, limit - personSpent(key));
}

/** 上限を超えていれば止める理由 */
export function checkPerson(key: string, role: VisitorRole = "general"): { ok: true } | { ok: false; status: number; error: string } {
  const limit = perPersonUsd(role);
  if (limit === null || personSpent(key) < limit) return { ok: true };
  return { ok: false, status: 429, error: PERSON_LIMIT_MESSAGE };
}

// ---- 側ごとの合計の上限（一般側 SHARE_GENERAL_POOL_USD・メンター側 SHARE_MENTOR_POOL_USD） ---------------------
//   見せる用の合計の上限（SHARE_BUDGET_USD）とは別に、一般の参加者の分とメンター・審査員の分の合計にそれぞれ上限を付ける
//   （一般の参加者が使い切っても、メンター・審査員は試せる。逆も同じ）。どちらも任意で、空ならその側には付けない
export const POOL_MESSAGE: Record<VisitorRole, string> = {
  general: "一般の参加者の分の API 代が上限に届いたので、API を使う操作（候補を出す・下書き・ネタ帳の更新など）を止めています。保存済みの例（?mock）と見るだけの操作は続けられます",
  mentor: "メンター・審査員の分の API 代が上限に届いたので、API を使う操作（候補を出す・下書き・ネタ帳の更新など）を止めています。保存済みの例（?mock）と見るだけの操作は続けられます",
};

/** その側の合計の上限（ドル）。見せる用で設定があるときだけ */
export function poolUsd(role: VisitorRole): number | null {
  if (shareMode() !== "lan") return null;
  return usdEnv(role === "mentor" ? "SHARE_MENTOR_POOL_USD" : "SHARE_GENERAL_POOL_USD");
}

/** その側で使った合計（人ごとの記録から。メンターとして使った分と、それ以外） */
export function poolSpent(role: VisitorRole): number {
  let mentor = 0;
  let all = 0;
  for (const v of Object.values(readLedger())) {
    all += v.usd ?? 0;
    mentor += v.mentor_usd ?? 0;
  }
  return role === "mentor" ? mentor : Math.max(0, all - mentor);
}

/** その側の上限に届いていれば止める理由 */
export function checkPool(role: VisitorRole): { ok: true } | { ok: false; status: number; error: string } {
  const limit = poolUsd(role);
  if (limit === null || poolSpent(role) < limit) return { ok: true };
  return { ok: false, status: 429, error: POOL_MESSAGE[role] };
}

/** 側ごとの上限の設定の問題（数でない・0以下）。なければ null */
export function poolConfigProblem(): string | null {
  for (const name of ["SHARE_GENERAL_POOL_USD", "SHARE_MENTOR_POOL_USD"]) {
    const raw = (process.env[name] ?? "").trim();
    if (raw && !(Number(raw) > 0)) return `${name}（見せる用の側ごとの API 代の上限）は 0 より大きい数にしてください（例：一般 20・メンター 30）`;
  }
  return null;
}

const als = new AsyncLocalStorage<{ key: string; role: VisitorRole }>();

/** いまの人の役割（API を使う窓口の中、裏で続く処理の中も）。外なら null。実行の記録に role を付けるのに使う（③） */
export const currentRole = (): VisitorRole | null => als.getStore()?.role ?? null;

/** 記録した API 代を、いまの人に足す（lib/usage.ts の recordUsage から呼ぶ）。見せる用で人の中にいるときだけ */
export function notePersonUsage(costUsd: number): void {
  const ctx = als.getStore();
  if (!ctx || shareMode() !== "lan" || !(costUsd > 0)) return;
  const ledger = readLedger();
  const cur = ledger[ctx.key] ?? { usd: 0, calls: 0, last_at: "" };
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const mentorUsd = round((cur.mentor_usd ?? 0) + (ctx.role === "mentor" ? costUsd : 0));
  ledger[ctx.key] = {
    usd: round(cur.usd + costUsd),
    calls: cur.calls + 1,
    last_at: new Date().toISOString(),
    ...(ctx.role === "mentor" || cur.role === "mentor" ? { role: "mentor" as const } : {}),
    ...(mentorUsd > 0 ? { mentor_usd: mentorUsd } : {}),
  };
  writeLedger(ledger);
}

/** 人の中で動かす（テスト用にも使う） */
export const runAsPerson = <T>(key: string, fn: () => T, role: VisitorRole = "general"): T => als.run({ key, role }, fn);

/**
 * API を使う窓口を包む：要求の人の印を読み、その中で動かす（裏で続く処理の記録も、その人に足す）。
 * 発表用では何もしない。上限の判定は入口（proxy.ts）でする。
 */
export function perPerson<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return (...args: A) => {
    if (shareMode() !== "lan" || !(args[0] instanceof Request)) return fn(...args);
    return als.run({ key: visitorKeyOf(args[0]), role: roleOf(args[0]) }, () => fn(...args));
  };
}
