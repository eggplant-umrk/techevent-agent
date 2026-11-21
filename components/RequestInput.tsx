"use client";

import { useState } from "react";

import type { InboxDetail, SpeakingRequest } from "@/app/_client/types";
import { md, PATTERN_LABEL } from "./labels";
import { Tag } from "./ui";

/** preset：届いた依頼（サンプル）から選ぶ／custom：手で追加（受信箱に入る）／inbox：受信箱から開いた依頼 */
export type RequestMode = "preset" | "custom" | "inbox";

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function RequestInput({
  presets,
  selected,
  onSelect,
  mode,
  onMode,
  customText,
  onCustomText,
  running,
  onRun,
  inbox,
  adding,
  onAdd,
  compact,
  children,
}: {
  presets: SpeakingRequest[];
  selected: string;
  onSelect: (id: string) => void;
  mode: RequestMode;
  onMode: (m: RequestMode) => void;
  customText: string;
  onCustomText: (t: string) => void;
  running: boolean;
  onRun: () => void;
  /** 受信箱から開いた依頼（mode === "inbox" のとき） */
  inbox: InboxDetail | null;
  adding: boolean;
  /** 手で追加：受信箱に入れて、候補づくりを始める */
  onAdd: () => void;
  /** After a run, show only the summary of the request (the picker folds away). */
  compact: boolean;
  /** The agent's steps, shown under the request without another frame. */
  children?: React.ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  const current = presets.find((p) => p.id === selected);
  const preparing = mode === "inbox" && inbox?.status === "processing";

  return (
    <section className="surface pad-lg req" aria-labelledby="req-title">
      <div className="row-between">
        <h2 id="req-title" className="h2">
          依頼
        </h2>
        <div role="group" aria-label="依頼の入れ方" className="seg">
          <button type="button" className="chip" aria-pressed={mode === "preset"} onClick={() => onMode("preset")}>
            届いた依頼から選ぶ
          </button>
          <button type="button" className="chip" aria-pressed={mode === "custom"} onClick={() => onMode("custom")}>
            手で追加
          </button>
        </div>
      </div>

      {mode === "inbox" && inbox && (
        <div className="req-summary">
          <p className="meta inbox-marks">
            <Tag tone={inbox.status === "ready" ? "ok" : inbox.status === "error" ? "warn" : "neutral"}>
              {inbox.status === "ready" ? "候補準備済み" : inbox.status === "error" ? "エラー" : "候補を準備中"}
            </Tag>
            <span>
              受信箱・{inbox.source === "slack" ? "Slackから" : "手で追加"}・{when(inbox.received_at)}
            </span>
            {inbox.permalink && (
              <a href={inbox.permalink} target="_blank" rel="noreferrer">
                Slackで開く
              </a>
            )}
          </p>
          <h3 className="req-title">{inbox.title}</h3>
          <details className="req-message" open={!compact}>
            <summary>依頼文を読む</summary>
            <p className="pre small">{inbox.text}</p>
          </details>
          {inbox.status === "error" && <p className="error-line" role="alert">{inbox.error ?? "候補を出せませんでした"}。「もう一度探す」を押してください。</p>}
        </div>
      )}

      {mode === "preset" && (
        <>
          {(!compact || picking) && (
            <div role="group" aria-label="届いた依頼" className="req-list">
              {presets.map((p) => (
                <button key={p.id} type="button" className="req-item" aria-pressed={p.id === selected} onClick={() => {
                    onSelect(p.id);
                    setPicking(false);
                  }}>
                  <span className="meta">
                    {PATTERN_LABEL[p.pattern ?? ""] ?? p.pattern}・{md(p.event?.date)}
                  </span>
                  <span className="strong">{p.event?.title}</span>
                </button>
              ))}
            </div>
          )}
          {current && (
            <div className="req-summary">
              <p className="meta">
                {PATTERN_LABEL[current.pattern ?? ""] ?? current.pattern}
                {current.reply_deadline ? `・返事の期限 ${md(current.reply_deadline)}` : ""}
                {compact && !picking && (
                  <>
                    {"　"}
                    <button type="button" className="link" onClick={() => setPicking(true)}>
                      依頼を選び直す
                    </button>
                  </>
                )}
              </p>
              <h3 className="req-title">{current.event?.title}</h3>
              <p className="small muted-strong">
                {current.event?.date}・{current.event?.venue}
                {current.event?.online ? "（オンラインあり）" : ""}／{current.event?.format} {current.event?.duration_min}分・
                {current.theme ? `テーマ「${current.theme}」` : "テーマおまかせ"}／{current.event?.audience}
              </p>
              <details className="req-message">
                <summary>依頼文を読む（{current.requester?.organization}）</summary>
                <p className="pre small">{current.message}</p>
              </details>
            </div>
          )}
        </>
      )}

      {mode === "custom" && (
        <label className="field">
          <span className="field-label">依頼文（追加すると受信箱に入り、Agentが候補を準備します）</span>
          <textarea
            className="input"
            rows={5}
            placeholder="例：来月のLT会でLayerXさんの枠を1つ用意しています。テーマはお任せします。"
            value={customText}
            onChange={(e) => onCustomText(e.target.value)}
          />
        </label>
      )}

      <div className="btn-row">
        {mode === "custom" ? (
          <button type="button" className="btn btn-primary" disabled={adding || !customText.trim()} onClick={onAdd}>
            {adding ? "受信箱に追加しています…" : "受信箱に追加"}
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={running || preparing || (mode === "inbox" && !inbox)} onClick={onRun}>
            {preparing ? "候補を準備しています…" : running ? "ネタ帳を探しています…" : compact || mode === "inbox" ? "もう一度探す" : "ネタ帳から候補を出す"}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
