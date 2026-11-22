// 評価（Evals）のケースの形。説明は docs/evals.md。
// 評価の側だけが使う（アプリの動きは変えない）。ファイルやデータを読まない、型と純粋な関数だけにする
// （「使われた結果 → 評価のケース」の変換や、評価を流すスクリプトから使う）。
import type { ProposalResult } from "./agent";
import type { IntakeReading } from "./intake";

/** 出どころ：手で作った／試験の一覧（scripts/fixtures/edge_cases.ts など）／使われた結果（受信箱・打診の記録から） */
export type EvalSource = "handmade" | "edge_list" | "usage";

/**
 * どちらの評価に入れるか。
 * keep（保つ）：今できていることを守る。点数が 90% を切ったら失敗。オフラインで CI に入れる
 * raise（上げる）：まだ弱いところ・本番で失敗したところ。main とブランチの点数を比べ、5% 以上下がったら失敗
 */
export type EvalSuite = "keep" | "raise";

/** 入力。受信箱に貼られた文か、サンプルの依頼か、カード（出し先を探す） */
export type EvalInput =
  | { kind: "inbox"; text: string; channel?: "manual" | "slack"; received_at?: string }
  | { kind: "request"; request_id: string }
  | { kind: "venue"; card_id: string };

/** 優先度：起きる頻度（1 まれ・2 ときどき・3 よくある）× 失敗したときの不満（1 小さい・2 困る・3 信頼をなくす） */
export interface EvalPriority {
  frequency: 1 | 2 | 3;
  pain: 1 | 2 | 3;
}

/** AI に判定させる観点（コードで測れないものだけ）。1観点＝1つの問い。根拠が足りなければ「分からない」を返させる */
export interface JudgeAspect {
  /** 観点の名前（例：「声かけ文の自然さ」） */
  aspect: string;
  /** はい／いいえ で答えられる問い（「はい」が合格） */
  question: string;
  /** どの文を見せるか */
  target: "candidates" | "outreach" | "organizer_reply";
}

/** その入力で実際に出た結果（保存済みの結果、または今流した結果）。あるものだけ入れる */
export interface EvalOutput {
  /** 受信箱の状態（ready・error など）と、読み取りの種類（依頼／依頼ではない／不適切） */
  status?: string | null;
  intake?: IntakeReading | null;
  result?: ProposalResult | null;
  /** 下書き（作ったときだけ） */
  draft?: { subject?: string; message?: string; organizer_reply?: string | null; organizer_reply_note?: string | null } | null;
  /** 入口で断られたときの理由（受け付けなかった文） */
  rejected?: string | null;
  /** 使われた結果から来たケースだけ：人がどうしたか */
  human?: {
    /** 進めた人（承認した候補）の社員 id */
    approved_employee_id?: string | null;
    outcome?: "accepted" | "declined" | null;
    decline_reason?: string | null;
    /** 下書きを直してから使ったか */
    edited?: boolean;
    note?: string | null;
  } | null;
  /** いつ・どの版で出た結果か */
  recorded_at?: string | null;
  usd?: number | null;
}

export interface EvalCase {
  /** 重ならない id（例：edge-R1、req-req004、usage-inb-xxxx） */
  id: string;
  source: EvalSource;
  /** 出どころの詳細（もとの id・ファイル・いつ記録したか） */
  origin?: { ref?: string; recorded_at?: string; note?: string };
  title: string;
  input: EvalInput;
  /** 期待する動き（人が読む文） */
  expect: string;
  /** コードの判定の名前の並び（scripts/evals/checks.ts の登録名）。全部通れば、コードの判定は合格 */
  checks: string[];
  /** 判定に渡す値（想定候補の id、出てはいけない言葉 など。判定ごとに読むものが決まっている） */
  params?: Record<string, unknown>;
  /** AI に判定させる観点（なくてよい。コードで測れるものはコードで） */
  judge?: JudgeAspect[];
  priority: EvalPriority;
  /** 許せる失敗率（0〜1）。k 回流したうち、失敗がこの割合以下なら通ったとみなす。1回だけなら 0 と同じ */
  allowed_failure_rate: number;
  suite: EvalSuite;
  /** オフラインで判定するための保存済みの結果。なければ、オンラインでしか判定できない */
  recorded?: EvalOutput | null;
}

/** 1つの判定の結果。unknown＝分からない（AI の判定で根拠が足りないとき、または材料がなくて判定できないとき） */
export type Verdict = "pass" | "fail" | "unknown";
export interface CheckResult {
  name: string;
  verdict: Verdict;
  detail?: string;
}
export interface CaseResult {
  id: string;
  suite: EvalSuite;
  /** 重み（頻度 × 不満、1〜9） */
  weight: number;
  /** 通ったか。fail が1つでもあれば false。unknown だけなら null（点数に入れない） */
  passed: boolean | null;
  checks: CheckResult[];
}

/** 重み：頻度 × 不満（1〜9） */
export const priorityWeight = (p: EvalPriority): number => p.frequency * p.pain;
/** 優先度が高い（重み 6 以上）。安定性の評価（k 回流す）の対象 */
export const isHighPriority = (p: EvalPriority): boolean => priorityWeight(p) >= 6;

export const KEEP_PASS_RATE = 0.9;
export const RAISE_MAX_DROP = 0.05;

/** 1件の結果をまとめる：fail が1つでもあれば不合格、pass だけなら合格、unknown が混ざって fail がなければ「分からない」は数えずに合格、全部 unknown なら null */
export function caseVerdict(checks: CheckResult[]): boolean | null {
  if (checks.some((c) => c.verdict === "fail")) return false;
  if (checks.some((c) => c.verdict === "pass")) return true;
  return null;
}

/** 点数：通ったケースの重みの合計 ÷ 判定できたケースの重みの合計（0〜1）。判定できたケースがなければ null */
export function weightedScore(results: Array<Pick<CaseResult, "weight" | "passed">>): number | null {
  const judged = results.filter((r) => r.passed !== null);
  const total = judged.reduce((n, r) => n + r.weight, 0);
  if (!total) return null;
  return judged.filter((r) => r.passed).reduce((n, r) => n + r.weight, 0) / total;
}

/** k 回流した結果から、許せる失敗率の中に収まっているか */
export function withinAllowedFailures(passes: number, runs: number, allowedFailureRate: number): boolean {
  return runs > 0 && (runs - passes) / runs <= allowedFailureRate + 1e-9;
}

/** ケースの形の検査（変換や手書きの誤りを見つける）。問題の一覧を返す（空なら問題なし） */
export function evalCaseProblems(c: EvalCase, knownChecks?: Iterable<string>): string[] {
  const out: string[] = [];
  const known = knownChecks ? new Set(knownChecks) : null;
  if (!c.id || !/^[\w.:-]+$/.test(c.id)) out.push(`id は英数字と - _ . : だけにしてください（${c.id}）`);
  if (!["handmade", "edge_list", "usage"].includes(c.source)) out.push(`${c.id}：source は handmade・edge_list・usage のどれかです`);
  if (!["keep", "raise"].includes(c.suite)) out.push(`${c.id}：suite は keep か raise です`);
  if (!c.title?.trim()) out.push(`${c.id}：title が空です`);
  if (!c.expect?.trim()) out.push(`${c.id}：expect（期待する動き）が空です`);
  const i = c.input as { kind?: string; text?: string; request_id?: string; card_id?: string } | undefined;
  if (!i || !["inbox", "request", "venue"].includes(i.kind ?? "")) out.push(`${c.id}：input.kind は inbox・request・venue のどれかです`);
  else if (i.kind === "inbox" && typeof i.text !== "string") out.push(`${c.id}：input.text（貼られた文）がありません`);
  else if (i.kind === "request" && !i.request_id) out.push(`${c.id}：input.request_id がありません`);
  else if (i.kind === "venue" && !i.card_id) out.push(`${c.id}：input.card_id がありません`);
  if (!Array.isArray(c.checks)) out.push(`${c.id}：checks は判定の名前の並びです`);
  else {
    if (!c.checks.length && !c.judge?.length) out.push(`${c.id}：判定が1つもありません（checks か judge を入れてください）`);
    if (known) for (const n of c.checks) if (!known.has(n)) out.push(`${c.id}：判定「${n}」は登録されていません`);
  }
  for (const j of c.judge ?? []) {
    if (!j.aspect?.trim() || !j.question?.trim()) out.push(`${c.id}：judge には aspect（観点）と question（問い）が要ります`);
    if (!["candidates", "outreach", "organizer_reply"].includes(j.target)) out.push(`${c.id}：judge.target は candidates・outreach・organizer_reply のどれかです`);
  }
  const p = c.priority;
  if (!p || ![1, 2, 3].includes(p.frequency) || ![1, 2, 3].includes(p.pain)) out.push(`${c.id}：priority は frequency・pain とも 1〜3 です`);
  if (typeof c.allowed_failure_rate !== "number" || c.allowed_failure_rate < 0 || c.allowed_failure_rate >= 1) out.push(`${c.id}：allowed_failure_rate は 0 以上 1 未満です`);
  if (c.source === "usage" && !c.origin?.ref) out.push(`${c.id}：使われた結果から来たケースには origin.ref（もとの依頼の id）を入れてください`);
  return out;
}
