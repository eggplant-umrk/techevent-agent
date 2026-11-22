"use client";
// 使われた結果（フィードバック）と、実行の記録（trace）の画面側。
//   送り先・読み先は記録の側（③：POST /api/feedback と traces を読む関数）。形はここで決めて、記録の側に合わせる。
//   画面は送るだけで、確認の窓は出さない。送れなくても操作は続けられる（小さく「送れませんでした」と出すだけ）。
import { createContext, useCallback, useContext, useRef, useState } from "react";

/** 「この候補は違う」の理由 */
export type WrongReason = "theme_mismatch" | "busy" | "not_their_work" | "other";
export const WRONG_REASON_LABEL: Record<WrongReason, string> = {
  theme_mismatch: "テーマが合わない",
  busy: "忙しい",
  not_their_work: "本人の活動ではない",
  other: "その他",
};

/** POST /api/feedback の本文 */
export type FeedbackInput =
  | { kind: "candidate_wrong"; request_id: string; employee_id: string; reason: WrongReason; note?: string }
  | {
      /** draft：声かけの下書き ／ organizer_reply：主催者への返事 */
      kind: "draft" | "organizer_reply";
      request_id: string;
      employee_id: string | null;
      /** good：直さずに使った ／ edited：直してから使った */
      verdict: "good" | "edited";
      /** 直す前（Agent が出した文） */
      before: string;
      /** 使った文（good なら before と同じ） */
      after: string;
    };

/** 実行の記録の1つ（AI の呼び出し・ツールの呼び出し） */
export interface TraceStep {
  kind: "llm" | "tool";
  /** 何をしたか（ツールの名前・AI の呼び出しの目的） */
  name: string;
  /** 始まり（ISO） */
  started_at: string;
  /** かかった時間 */
  ms: number;
  /** 金額（AI の呼び出しだけ。分からなければ null） */
  usd: number | null;
  ok: boolean;
  /** 失敗したときの短い理由（使う人向けの文） */
  error?: string | null;
}

/** 1つの依頼の実行の記録 */
export interface RequestTrace {
  request_id: string;
  started_at: string;
  total_ms: number;
  total_usd: number;
  steps: TraceStep[];
}

interface FeedbackCtx {
  requestId: string | null;
  send: (input: FeedbackInput) => Promise<void>;
}
const Ctx = createContext<FeedbackCtx>({ requestId: null, send: async () => {} });
export const FeedbackProvider = Ctx.Provider;
export const useFeedback = () => useContext(Ctx);

/** 送ったあとの小さな一言 */
export const FEEDBACK_DONE = "次からの評価に使います";

/**
 * 下書き・返事を「使った」（コピーした）ときに、good／edited を送る。
 * 同じ文を何度コピーしても送るのは1回。直してから別の文をコピーしたら、もう1回送る。
 */
export function useUsedFeedback(kind: "draft" | "organizer_reply", employeeId: string | null, original: string) {
  const { requestId, send } = useFeedback();
  const lastSent = useRef<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const onUsed = useCallback(
    (used: string) => {
      if (!requestId || lastSent.current === used) return;
      lastSent.current = used;
      const verdict = used === original ? "good" : "edited";
      send({ kind, request_id: requestId, employee_id: employeeId, verdict, before: original, after: used })
        .then(() => setNote(FEEDBACK_DONE))
        .catch(() => {
          lastSent.current = null;
          setNote("評価用の記録を送れませんでした（コピーはできています）");
        });
    },
    [requestId, send, kind, employeeId, original],
  );
  return { onUsed, note };
}

/** 1分2秒・850ミリ秒などの短い言い方 */
export function durationText(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ミリ秒`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  return `${Math.floor(s / 60)}分${String(s % 60).padStart(2, "0")}秒`;
}

/** $0.81（0.01未満は $0.004 のように3桁） */
export const usdText = (usd: number) => `$${usd >= 0.01 || usd === 0 ? usd.toFixed(2) : usd.toFixed(3)}`;
