"use client";
// 使われた結果（フィードバック）と、実行の記録（trace）の画面側。
//   送り先・読み先は記録の側（③：POST /api/feedback〔lib/feedback.ts〕と getTrace〔lib/trace.ts〕）。形はそちらに合わせる。
//   画面は送るだけで、確認の窓は出さない。送れなくても操作は続けられる（小さく「送れませんでした」と出すだけ）。
import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { Trace } from "@/lib/trace";
import type { FeedbackTarget } from "@/lib/feedback";

/** 理由の選択肢（記録の側 lib/feedback.ts の REASON_CODES そのもの。/api/state の feedback_reasons で受け取る） */
export type ReasonCodes = Record<FeedbackTarget, Record<string, string>>;

/** POST /api/feedback の本文（lib/feedback.ts の parseFeedback の形） */
export interface FeedbackInput {
  request_id: string;
  /** candidate：候補 ／ draft：声かけの下書き ／ reply：主催者への返事 */
  target: "candidate" | "draft" | "reply";
  /** 社員 id（候補の人・下書きや返事の相手） */
  target_id: string;
  /** wrong：この候補は違う ／ edited：直してから使った ／ good：直さずに使った ／ withdrawn：前に付けた「違う」の取り消し */
  verdict: "wrong" | "edited" | "good" | "withdrawn";
  /** 理由。good は "good"。コピーで「直して使った」と数えたときは理由を聞かないので "other" */
  reason_code: string;
  note?: string;
  /** 直す前（Agent が出した文）と、使った文（edited のとき） */
  before?: string;
  after?: string;
}

/** 1つの依頼の実行の記録（lib/trace.ts の Trace。名前・時間・数・成否だけ） */
export type RequestTrace = Trace;

interface FeedbackCtx {
  requestId: string | null;
  /** 理由の選択肢（REASON_CODES）。まだ読めていなければ null（ボタンを出さない） */
  reasons: ReasonCodes | null;
  send: (input: FeedbackInput) => Promise<void>;
  /** 「違う」と記録済みの候補（社員 id → 理由の言葉）。依頼の詳細から来る。読み直しても残る */
  wrong?: Record<string, string>;
  /** 送ったあとに、依頼の詳細を読み直す（印を出す・消すため） */
  refresh?: () => void;
}
const Ctx = createContext<FeedbackCtx>({ requestId: null, reasons: null, send: async () => {} });
export const FeedbackProvider = Ctx.Provider;
export const useFeedback = () => useContext(Ctx);

/** 送ったあとの小さな一言 */
export const FEEDBACK_DONE = "次からの評価に使います";

/**
 * 下書き・返事を「使った」（コピーした）ときに、good／edited を送る。
 * 同じ文を何度コピーしても送るのは1回。直してから別の文をコピーしたら、もう1回送る。
 * 送り先の依頼・相手の人が分からないときは何もしない。
 */
export function useUsedFeedback(target: "draft" | "reply", employeeId: string | null, original: string) {
  const { requestId, send } = useFeedback();
  const lastSent = useRef<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const onUsed = useCallback(
    (used: string) => {
      if (!requestId || !employeeId || lastSent.current === used) return;
      lastSent.current = used;
      const good = used === original;
      send({
        request_id: requestId,
        target,
        target_id: employeeId,
        verdict: good ? "good" : "edited",
        reason_code: good ? "good" : "other",
        ...(good ? {} : { before: original, after: used }),
      })
        .then(() => setNote(FEEDBACK_DONE))
        .catch(() => {
          lastSent.current = null;
          setNote("評価用の記録を送れませんでした（コピーはできています）");
        });
    },
    [requestId, send, target, employeeId, original],
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
