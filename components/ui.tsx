"use client";

import { useState, type ReactNode } from "react";
import type { NotebookCard } from "@/app/_client/types";
import { FORMAT_LABEL, STATUS_LABEL } from "./labels";

export type Tone = "neutral" | "accent" | "warn" | "ok";

/** Status is never color-only: every tag carries its label as text. */
export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

/** onCopied：コピーできたとき（下書き・返事を「使った」と数えるため） */
export function CopyButton({ text, label = "コピー", primary = false, onCopied }: { text: string; label?: string; primary?: boolean; onCopied?: (text: string) => void }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  return (
    <button
      type="button"
      className={primary ? "btn btn-primary" : "btn"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("done");
          onCopied?.(text);
        } catch {
          setState("fail");
        }
        setTimeout(() => setState("idle"), 2000);
      }}
    >
      {state === "done" ? "コピーしました" : state === "fail" ? "コピーできませんでした。選択してコピーしてください" : label}
    </button>
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
