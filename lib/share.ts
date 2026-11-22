// 窓口（/api）と画面に入れる人を決める。proxy.ts（すべてのリクエストの入口）から使う。画面の作りとは独立した純粋な関数にする。
//
// 既定（.env に SHARE_MODE がない）：Host と Origin が localhost／127.0.0.1 のときだけ受け付ける（同じ端末からだけ）
// SHARE_MODE=lan：同じネットワークの別の端末からも受け付ける。ただし ACCESS_CODE（合言葉）を入れた人だけ
//   - 画面を開くと、最初に合言葉の入力（/access）。合っていればブラウザに印（cookie、httpOnly）を付け、以後の画面と /api はそれで確かめる
//   - 同じ端末のスクリプト（Slack ボットなど）は X-Access-Code ヘッダーで合言葉を送る（Host は外から偽れるので、localhost でも合言葉なしでは通さない）
//   - Origin は自分のホストと一致するものだけを許す
//   - ACCESS_CODE が空のまま SHARE_MODE=lan にしたら、起動を止める（scripts/serve.mjs と next.config.ts）
// SHARE_BUDGET_USD：見せている間（このサーバーを起動してから）の API 代の上限。超えたら API を使う操作（候補を出す・ネタ帳の更新・分析・下書きなど）を止める
import { createHash, timingSafeEqual } from "node:crypto";

export type ShareMode = "local" | "lan";
export const ACCESS_COOKIE = "nb_access";
export const ACCESS_HEADER = "x-access-code";
export const ACCESS_PATH = "/access";
export const ACCESS_API = "/api/access";
/** 合言葉を打たずに入るリンク（GET /join?code=…） */
export const JOIN_PATH = "/join";

export const shareMode = (): ShareMode => ((process.env.SHARE_MODE ?? "").trim().toLowerCase() === "lan" ? "lan" : "local");
export const accessCode = () => (process.env.ACCESS_CODE ?? "").trim();
/** 合言葉の最短の長さ（scripts/serve.mjs と同じ）。短いと、回数の制限があっても当てられやすい */
export const MIN_ACCESS_CODE = 12;

/** 起動してはいけない設定なら、その理由（なければ null） */
export function shareConfigProblem(): string | null {
  const raw = (process.env.SHARE_MODE ?? "").trim().toLowerCase();
  if (raw && raw !== "lan" && raw !== "local") return `SHARE_MODE は lan か空（既定）です（今は「${raw}」）`;
  if (shareMode() === "lan" && !accessCode()) return "SHARE_MODE=lan のときは .env に ACCESS_CODE（合言葉）を設定してください。合言葉なしでは起動しません";
  if (shareMode() === "lan" && [...accessCode()].length < MIN_ACCESS_CODE)
    return `SHARE_MODE=lan のときは ACCESS_CODE（合言葉）を${MIN_ACCESS_CODE}文字以上にしてください（短いと当てられやすいため）。今の合言葉は短すぎます`;
  const mentorProblem = shareMode() === "lan" ? mentorConfigProblem() : null;
  if (mentorProblem) return mentorProblem;
  const perPerson = (process.env.SHARE_PER_PERSON_USD ?? "").trim();
  if (shareMode() === "lan" && perPerson && !(Number(perPerson) > 0))
    return `SHARE_PER_PERSON_USD（見せる用の1人あたりの API 代の上限）は 0 より大きい数にしてください（例：5）`;
  if (shareMode() === "lan" && shareBudgetUsd() === null)
    return "SHARE_MODE=lan のときは .env に SHARE_BUDGET_USD（見せている間の API 代の上限、例：5）を設定してください。上限なしでは起動しません";
  return null;
}

/** 見せる用（lan）では止める操作（今はなし） */
//   「ネタ帳を更新」は止めていたが、次の3つで守れるので開けた（11/22）：
//   1回の見積もりの上限（NOTEBOOK_BUDGET_USD、超えるなら始めない・途中で届いたら残りは次回）、
//   二重実行の防止（動いている間の2回目は 409）、1人あたりの上限（SHARE_PER_PERSON_USD）。合計の上限 SHARE_BUDGET_USD もそのまま
export const LAN_BLOCKED: Array<{ method: string; path: RegExp; reason: string }> = [];

/** 見せる用では、API 代などを出す ?debug を外した URL（外すものがなければ null） */
export function withoutDebug(url: URL): URL | null {
  if (!url.searchParams.has("debug")) return null;
  const u = new URL(url.toString());
  u.searchParams.delete("debug");
  return u;
}

/** cookie に入れる印（合言葉そのものは入れない） */
export const accessToken = (code = accessCode()) => createHash("sha256").update(`netacho-agent:${code}`).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
/** 入力された合言葉が合っているか */
export const codeMatches = (input: string | null | undefined) => !!accessCode() && !!input && safeEqual(input.trim(), accessCode());

// ---- メンター用の合言葉（MENTOR_ACCESS_CODE、任意） ----------------------------------------------
//   一般の合言葉と同じ守り（12文字以上・回数の制限・全体の上限・値を表示しない）。入った人は1人あたりの上限が SHARE_MENTOR_USD になり、
//   使われた結果・実行の記録に role: "mentor" が付く（lib/personBudget.ts の roleOf）。画面の見た目は一般の人と同じ
export const mentorCode = () => (process.env.MENTOR_ACCESS_CODE ?? "").trim();
/** メンターの印（cookie nb_role）の値。合言葉の値そのものは入れない */
export const mentorToken = (code = mentorCode()) => createHash("sha256").update(`netacho-mentor:${code}`).digest("hex");
export const MENTOR_COOKIE = "nb_role";
/** 入力された合言葉がメンター用か */
export const mentorCodeMatches = (input: string | null | undefined) => !!mentorCode() && !!input && safeEqual(input.trim(), mentorCode());
/** メンター用の設定の問題（なければ null）。設定しないなら問題なし */
export function mentorConfigProblem(): string | null {
  const m = mentorCode();
  const usd = (process.env.SHARE_MENTOR_USD ?? "").trim();
  if (usd && !(Number(usd) > 0)) return "SHARE_MENTOR_USD（メンターの1人あたりの API 代の上限）は 0 より大きい数にしてください（例：15）";
  if (!m) return null;
  if ([...m].length < MIN_ACCESS_CODE) return `MENTOR_ACCESS_CODE（メンター用の合言葉）は${MIN_ACCESS_CODE}文字以上にしてください（短いと当てられやすいため）。今の合言葉は短すぎます`;
  if (m === accessCode()) return "MENTOR_ACCESS_CODE（メンター用の合言葉）は ACCESS_CODE と別のものにしてください";
  return null;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"]);
/** Host ヘッダー（ポートつき）からホスト名だけ */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.replace(/:\d+$/, "");
}
export const isLoopback = (host: string) => LOOPBACK.has(hostnameOf(host));
/** Origin（https://host:port）のホスト部分（ポートつき）。読めなければ null */
function originHost(origin: string): string | null {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}

export interface GateInput {
  method: string;
  pathname: string;
  host: string | null;
  origin: string | null;
  forwardedFor: string | null;
  cookie: string | null;
  headerCode: string | null;
}
export type Gate = { ok: true } | { ok: false; status: number; error: string; redirectTo?: string };

/** 入口の確認（Host・Origin・合言葉）。API 代の上限は checkBudget で別に見る */
export function checkRequest(r: GateInput): Gate {
  const isApi = r.pathname.startsWith("/api/") || r.pathname === "/api";
  const problem = shareConfigProblem();
  if (problem) return { ok: false, status: 503, error: problem };
  if (!r.host) return { ok: false, status: 400, error: "Host がありません" };

  if (shareMode() === "local") {
    if (!isLoopback(r.host)) return { ok: false, status: 403, error: "localhost からのリクエストだけ受け付けます" };
    if (r.forwardedFor && !r.forwardedFor.split(",").every((ip) => LOOPBACK.has(ip.trim().toLowerCase())))
      return { ok: false, status: 403, error: "localhost からのリクエストだけ受け付けます" };
    if (isApi && r.origin) {
      const oh = originHost(r.origin);
      if (!oh || !isLoopback(oh)) return { ok: false, status: 403, error: "localhost の画面からのリクエストだけ受け付けます" };
    }
    return { ok: true };
  }

  // lan：Origin は自分のホストと一致するものだけ
  if (isApi && r.origin) {
    const oh = originHost(r.origin);
    if (!oh || oh !== r.host.trim().toLowerCase()) return { ok: false, status: 403, error: "この画面以外からのリクエストは受け付けません" };
  }
  // 見せる用で止める操作（合言葉の有無にかかわらず）
  const blocked = LAN_BLOCKED.find((b) => b.method === r.method && b.path.test(r.pathname));
  if (blocked) return { ok: false, status: 403, error: blocked.reason };
  // 合言葉の入力画面と、その送り先は合言葉なしで開ける
  // 合言葉のリンク（/join?code=…）も、合言葉の窓口と同じく合言葉なしで開ける（確かめるのは app/join/route.ts）
  if (r.pathname === ACCESS_PATH || (r.pathname === ACCESS_API && r.method === "POST") || (r.pathname === JOIN_PATH && r.method === "GET")) return { ok: true };
  const authed = (!!r.cookie && safeEqual(r.cookie, accessToken())) || codeMatches(r.headerCode) || mentorCodeMatches(r.headerCode);
  if (authed) return { ok: true };
  if (isApi) return { ok: false, status: 401, error: "合言葉が必要です。画面を開き直して、合言葉を入れてください" };
  return { ok: false, status: 303, error: "合言葉が必要です", redirectTo: `${ACCESS_PATH}?next=${encodeURIComponent(r.pathname)}` };
}

/** API を使う操作（POST）。上限を超えたら止める */
const SPENDING: RegExp[] = [
  /^\/api\/agent$/,
  /^\/api\/notebook$/,
  /^\/api\/events\/[^/]+\/analyze$/,
  /^\/api\/events\/[^/]+\/import$/,
  /^\/api\/draft$/,
  /^\/api\/blog-ideas$/,
  /^\/api\/venues(\/.*)?$/,
  /^\/api\/inbox$/,
  // 「依頼として進める」（依頼ではなさそうと読んだ1件の候補づくり）
  /^\/api\/inbox\/[^/]+\/proceed$/,
];
export const spendsApi = (method: string, pathname: string) => method === "POST" && SPENDING.some((re) => re.test(pathname));

export function shareBudgetUsd(): number | null {
  const v = Number((process.env.SHARE_BUDGET_USD ?? "").trim());
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** 見せている間の API 代（usage の記録のうち、since 以降のもの） */
export const spentSince = (records: Array<{ at: string; cost_usd: number }>, since: string) =>
  records.filter((e) => Date.parse(e.at) >= Date.parse(since)).reduce((n, e) => n + e.cost_usd, 0); // 日本時間（+09:00）と UTC が混ざっても時刻で比べる

/** API 代の上限。超えていれば止める理由 */
export function checkBudget(method: string, pathname: string, spent: number, budget = shareBudgetUsd()): Gate {
  if (budget === null || !spendsApi(method, pathname) || spent < budget) return { ok: true };
  return {
    ok: false,
    status: 429,
    error: `見せている間の API 代が上限（$${budget}）に届いたので、API を使う操作（候補を出す・ネタ帳の更新・分析・下書きなど）を止めています（いま $${spent.toFixed(2)}）。見るだけの操作は続けられます`,
  };
}
