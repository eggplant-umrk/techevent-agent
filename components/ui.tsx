"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { copyText } from "@/lib/copyText";
import type { NotebookCard } from "@/app/_client/types";
import { FORMAT_LABEL, STATUS_LABEL } from "./labels";

export type Tone = "neutral" | "accent" | "warn" | "ok";

/** Status is never color-only: every tag carries its label as text. */
export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

/**
 * onCopied：コピーできたとき（下書き・返事を「使った」と数えるため。コピーできなかったときは呼ばない）。
 * コピーは lib/copyText.ts：navigator.clipboard が使えないページ（IP アドレスで開いた http）では、古いやり方に切り替える。
 * それもだめなときは、文を選んだ欄を出して「Ctrl+C でコピーしてください」と伝える（状態は進めない）
 */
export function CopyButton({ text, label = "コピー", primary = false, onCopied }: { text: string; label?: string; primary?: boolean; onCopied?: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "done" | "manual">("idle");
  const [manualText, setManualText] = useState("");
  const manualRef = useRef<HTMLTextAreaElement>(null);
  // 手でコピーしてもらうとき：欄が出たら、文を全部選んだ状態にする
  useEffect(() => {
    if (state !== "manual") return;
    manualRef.current?.focus();
    manualRef.current?.select();
  }, [state, manualText]);
  return (
    <>
      <button
        type="button"
        className={primary ? "btn btn-primary" : "btn"}
        onClick={async () => {
          if (await copyText(text)) {
            setState("done");
            onCopied?.(text);
            setTimeout(() => setState((s) => (s === "done" ? "idle" : s)), 2000);
          } else {
            setManualText(text);
            setState("manual");
          }
        }}
      >
        {state === "done" ? "コピーしました" : label}
      </button>
      {state === "manual" && (
        <span className="copy-manual" role="group" aria-label="手でコピーする">
          <span className="log-line log-warn" role="status">
            自動でコピーできませんでした。下の文を選んであります。Ctrl+C でコピーしてください
          </span>
          <textarea ref={manualRef} className="input" readOnly rows={4} value={manualText} aria-label="コピーする文" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn" onClick={() => setState("idle")}>
            閉じる
          </button>
        </span>
      )}
    </>
  );
}

/** カードの印は2つまで：未発信／発信済みと、内容を確認済み（人の「情報を確認済み」と区別する）。 */
export function CardMarks({ card }: { card: NotebookCard }) {
  const unpublished = card.publication_status === "unpublished";
  return (
    <>
      <Tag tone={unpublished ? "warn" : "neutral"}>{unpublished ? "未発信" : "発信済み"}</Tag>
      {card.reviewed && <ReviewedMark />}
    </>
  );
}

export function ReviewedMark() {
  return (
    <span className="reviewed">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      内容を確認済み
    </span>
  );
}

/** "ブログ済み" / "登壇済み" etc. for the detail view, as plain text. */
export const statusText = (card: NotebookCard) =>
  card.publication_status === "unpublished" ? `${FORMAT_LABEL[card.format]}向き` : `${STATUS_LABEL[card.publication_status]}・${FORMAT_LABEL[card.format]}向き`;

export function Spinner({ label }: { label: string }) {
  return (
    <div className="working" role="status">
      <span className="dot" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="error-line" role="alert">
      {message}
    </p>
  );
}
