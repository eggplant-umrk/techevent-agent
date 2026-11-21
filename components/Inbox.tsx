"use client";

import type { InboxListItem } from "@/app/_client/types";
import { Tag } from "./ui";

const STATUS: Record<InboxListItem["status"], { label: string; tone: "neutral" | "ok" | "warn" }> = {
  processing: { label: "候補を準備中", tone: "neutral" },
  ready: { label: "候補準備済み", tone: "ok" },
  error: { label: "エラー", tone: "warn" },
};

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 画面の一番上。届いた依頼と、Agentが準備した候補の状態が一目で分かる。押すとその依頼の候補画面が開く */
export function Inbox({
  items,
  loaded,
  openId,
  onOpen,
}: {
  items: InboxListItem[];
  loaded: boolean;
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const fresh = items.filter((x) => x.is_new).length;
  const ready = items.filter((x) => x.status === "ready").length;
  const preparing = items.filter((x) => x.status === "processing").length;

  return (
    <section className="surface pad-lg inbox" aria-labelledby="inbox-title">
      <div className="row-between">
        <h2 id="inbox-title" className="h2">
          受信箱
        </h2>
        <p className="meta" aria-live="polite">
          {items.length === 0
            ? ""
            : [fresh ? `新しい依頼 ${fresh}件` : "", ready ? `候補準備済み ${ready}件` : "", preparing ? `準備中 ${preparing}件` : ""].filter(Boolean).join("・")}
        </p>
      </div>

      {!loaded ? (
        <p className="meta">読み込んでいます…</p>
      ) : items.length === 0 ? (
        <p className="meta">まだ依頼はありません。Slackで届いた依頼や、下の「手で追加」から入れた依頼がここに並び、候補が自動で準備されます。</p>
      ) : (
        <ul className="inbox-list">
          {items.map((it) => {
            const s = STATUS[it.status];
            return (
              <li key={it.id}>
                <button type="button" className="inbox-item" aria-current={it.id === openId ? "true" : undefined} onClick={() => onOpen(it.id)}>
                  <span className="inbox-marks">
                    {it.is_new && <Tag tone="accent">新しい</Tag>}
                    <Tag tone={s.tone}>{s.label}</Tag>
                    <span className="meta">
                      {it.source === "slack" ? "Slack" : "手で追加"}・{when(it.received_at)}
                    </span>
                  </span>
                  <span className="strong inbox-title">{it.title}</span>
                  <span className="meta">
                    {it.status === "processing"
                      ? "Agentがネタ帳を探しています"
                      : it.status === "error"
                        ? it.error ?? "候補を出せませんでした"
                        : it.no_fit
                          ? "合う候補は見つかりませんでした（理由を確認できます）"
                          : `候補：${it.candidate_names.join("・")}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
