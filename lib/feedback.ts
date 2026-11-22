// 使われた結果の記録：人が候補・下書き・返事・読み取った項目を「違う／直した／よい」と付けたものを、
// data/runtime/feedback.jsonl に1行ずつ足す（消さない・書き換えない）。書く窓口は app/api/feedback、ボタンは①が作る。
// あとで npm run eval:from-feedback が、評価のケースの候補に変える（個人情報を落としてから。コミットは人が確かめてから）。
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { nowJst } from "./clock";
import { runtimeFile } from "./runtime";

export type FeedbackTarget = "candidate" | "draft" | "reply" | "intake_field";
export type FeedbackVerdict = "wrong" | "edited" | "good";

/** 理由の候補（コードと画面に出す言葉）。対象ごとに決める */
export const REASON_CODES: Record<FeedbackTarget, Record<string, string>> = {
  candidate: { theme_mismatch: "テーマが合わない", busy: "忙しい", not_own_activity: "本人の活動ではない", other: "その他" },
  draft: { wording: "言い回し", factual_error: "事実の誤り", length: "長さ", other: "その他" },
  // 主催者への返事は下書きと同じ見方
  reply: { wording: "言い回し", factual_error: "事実の誤り", length: "長さ", other: "その他" },
  intake_field: { misread: "読み違い", missing: "読み落とし", other: "その他" },
};
/** 「よい」のときは理由を問わない */
export const GOOD_REASON = "good";

export interface Feedback {
  id: string;
  at: string;
  request_id: string;
  target: FeedbackTarget;
  /** candidate：社員 id／draft・reply：社員 id（誰あての下書きか）／intake_field：項目の名前（event_name・date など） */
  target_id: string;
  verdict: FeedbackVerdict;
  reason_code: string;
  note?: string;
  /** 直す前と直したあと（edited のとき） */
  before?: string;
  after?: string;
}

export const feedbackFile = () => runtimeFile("feedback.jsonl");

const MAX_NOTE = 1000;
const MAX_TEXT = 4000;
const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;

/** 窓口の入力を確かめる。問題があれば理由、なければ整えた入力 */
export function parseFeedback(body: unknown): { ok: true; value: Omit<Feedback, "id" | "at"> } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "JSON の本文がありません" };
  const b = body as Record<string, unknown>;
  if (typeof b.request_id !== "string" || !ID_RE.test(b.request_id)) return { ok: false, error: "request_id がありません（または形が違います）" };
  if (typeof b.target !== "string" || !(b.target in REASON_CODES)) return { ok: false, error: 'target は "candidate"・"draft"・"reply"・"intake_field" のどれかです' };
  const target = b.target as FeedbackTarget;
  if (typeof b.target_id !== "string" || !ID_RE.test(b.target_id)) return { ok: false, error: "target_id がありません（または形が違います）" };
  if (b.verdict !== "wrong" && b.verdict !== "edited" && b.verdict !== "good") return { ok: false, error: 'verdict は "wrong"・"edited"・"good" のどれかです' };
  const verdict = b.verdict as FeedbackVerdict;
  const codes = REASON_CODES[target];
  const reason = typeof b.reason_code === "string" ? b.reason_code : verdict === "good" ? GOOD_REASON : "";
  if (verdict === "good" ? reason !== GOOD_REASON && !(reason in codes) : !(reason in codes)) {
    return { ok: false, error: `reason_code は ${Object.keys(codes).join("・")} のどれかです` };
  }
  const str = (k: "note" | "before" | "after", max: number): string | undefined | null => {
    if (b[k] === undefined || b[k] === null || b[k] === "") return undefined;
    if (typeof b[k] !== "string") return null;
    return (b[k] as string).slice(0, max);
  };
  const note = str("note", MAX_NOTE);
  const before = str("before", MAX_TEXT);
  const after = str("after", MAX_TEXT);
  if (note === null || before === null || after === null) return { ok: false, error: "note・before・after は文字列です" };
  return {
    ok: true,
    value: {
      request_id: b.request_id,
      target,
      target_id: b.target_id,
      verdict,
      reason_code: reason,
      ...(note ? { note } : {}),
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    },
  };
}

/** 1行足す。足した記録を返す */
export function appendFeedback(v: Omit<Feedback, "id" | "at">): Feedback {
  const fb: Feedback = { id: `fb-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, at: nowJst(), ...v };
  const f = feedbackFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  // 1行ずつ足すだけ（前の行は書き換えない）。途中で止まって書きかけの行が残っても、読む側が飛ばす
  fs.appendFileSync(/*turbopackIgnore: true*/ f, JSON.stringify(fb) + "\n", "utf-8");
  return fb;
}

/** すべて読む（古い順）。読めない行（書きかけなど）は飛ばし、数をサーバーの記録に残す */
export function readFeedback(file = feedbackFile()): Feedback[] {
  let text = "";
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return [];
    text = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8");
  } catch {
    return [];
  }
  const out: Feedback[] = [];
  let bad = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line) as Feedback;
      if (v && typeof v === "object" && typeof v.request_id === "string" && typeof v.target === "string") out.push(v);
      else bad++;
    } catch {
      bad++;
    }
  }
  if (bad) console.error(`[使われた結果の記録] 読めない行を ${bad}行 飛ばしました（${path.basename(file)}）`);
  return out;
}
