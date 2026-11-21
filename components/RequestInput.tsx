"use client";

import { useState } from "react";

import type { SpeakingRequest } from "@/app/_client/types";
import { md, PATTERN_LABEL } from "./labels";

export type RequestMode = "preset" | "custom";

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
  /** After a run, show only the summary of the request (the picker folds away). */
  compact: boolean;
  /** The agent's steps, shown under the request without another frame. */
  children?: React.ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  const current = presets.find((p) => p.id === selected);

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
            依頼文を貼る
          </button>
        </div>
      </div>

      {mode === "preset" ? (
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
      ) : (
        <label className="field">
          <span className="field-label">依頼文</span>
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
        <button type="button" className="btn btn-primary" disabled={running || (mode === "custom" && !customText.trim())} onClick={onRun}>
          {running ? "ネタ帳を探しています…" : compact ? "もう一度探す" : "ネタ帳から候補を出す"}
        </button>
      </div>
      {children}
    </section>
  );
}
