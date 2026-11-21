"use client";

import { useState, type ReactNode } from "react";
import type { NotebookCard } from "@/app/_client/types";
import { FORMAT_LABEL, STATUS_LABEL } from "./labels";

export type Tone = "neutral" | "accent" | "warn" | "ok";

/** Status is never color-only: every tag carries its label as text. */
export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export function CopyButton({ text, label = "コピー", primary = false }: { text: string; label?: string; primary?: boolean }) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  return (
    <button
      type="button"
      className={primary ? "btn btn-primary" : "btn"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("done");
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

/** Tags shown on a notebook row and in the card detail. */
export function CardTags({ card, compact = false }: { card: NotebookCard; compact?: boolean }) {
  const e = card.employee;
  return (
    <>
      <Tag tone={card.publication_status === "unpublished" ? "warn" : "neutral"}>{STATUS_LABEL[card.publication_status]}</Tag>
      {e && e.past_talk_count === 0 && <Tag>登壇0回</Tag>}
      <Tag tone="accent">{FORMAT_LABEL[card.format]}向き</Tag>
      {card.reviewed && <Tag tone="ok">確認済み</Tag>}
      {card.pending_themes.length > 0 && <Tag tone="warn">新しいテーマ案（未確認）</Tag>}
      {!compact && card.outreach_history.length > 0 && <Tag>打診 {card.outreach_history.length}件</Tag>}
    </>
  );
}

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
