"use client";
// 「この依頼の記録」：AI の呼び出しとツールの呼び出しを、順番・時間・金額・成否で時間の線に並べる。
// 開いたときだけ読み込む。見せる用（SHARE_MODE=lan）でも出す（中身は名前・時間・金額・成否だけ）。
import { useState } from "react";
import type { Api } from "@/app/_client/api";
import { durationText, usdText, type RequestTrace } from "@/app/_client/feedback";
import { traceErrorLabel, traceStepLabel } from "@/lib/traceLabel";

const KIND_LABEL = { llm: "AI", tool: "ツール", code: "処理" } as const;

export function TraceTimeline({ api, requestId }: { api: Api; requestId: string }) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<RequestTrace | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && trace === undefined) {
      try {
        setTrace(await api.trace(requestId));
      } catch (e) {
        setError(e instanceof Error ? e.message : "記録を読めませんでした");
      }
    }
  }

  return (
    <section className="trace" aria-label="この依頼の記録">
      <button type="button" className="link" aria-expanded={open} onClick={toggle}>
        {open ? "この依頼の記録を閉じる" : "この依頼の記録"}
      </button>
      {open && (
        <div className="trace-body">
          {error ? (
            <p className="meta warn-text">{error}</p>
          ) : trace === undefined ? (
            <p className="meta">読み込んでいます…</p>
          ) : trace === null ? (
            <p className="meta">この依頼の記録はまだありません。</p>
          ) : (
            <TraceView trace={trace} mock={api.mock} />
          )}
        </div>
      )}
    </section>
  );
}

function TraceView({ trace, mock }: { trace: RequestTrace; mock: boolean }) {
  // 線の長さは、最初の呼び出しの始まりから最後の呼び出しの終わりまで（もう一度探した・下書きを作ったも同じ線に並ぶ）
  const starts = trace.steps.map((s) => Date.parse(s.started_at)).filter(Number.isFinite);
  const t0 = starts.length ? Math.min(...starts) : Date.parse(trace.started_at);
  const end = Math.max(t0 + 1, ...trace.steps.map((s) => Date.parse(s.started_at) + s.ms).filter(Number.isFinite));
  const total = Math.max(1, end - t0);
  const llm = trace.steps.filter((s) => s.kind === "llm").length;
  const tools = trace.steps.filter((s) => s.kind === "tool").length;
  const failed = trace.steps.filter((s) => !s.ok).length;
  return (
    <>
      <p className="meta">
        合計 {durationText(trace.total_ms)}・{usdText(trace.total_cost_usd)}・AI {llm}回・ツール {tools}回{failed ? `・失敗 ${failed}回` : ""}
        {mock && "（モックの見本）"}
      </p>
      <ol className="trace-list">
        {trace.steps.map((s, i) => {
          const start = Math.max(0, (Date.parse(s.started_at) - t0) / total);
          const width = Math.max(0.006, s.ms / total);
          return (
            <li key={i} className={`trace-row${s.ok ? "" : " trace-fail"}`}>
              <span className={`trace-kind trace-kind-${s.kind}`}>{KIND_LABEL[s.kind]}</span>
              <span className="trace-name" title={s.name}>
                {traceStepLabel(s.kind, s.name)}
              </span>
              <span className="trace-track" aria-hidden="true">
                <span className={`trace-bar trace-bar-${s.kind}`} style={{ left: `${Math.min(100, start * 100)}%`, width: `${Math.min(100 - start * 100, width * 100)}%` }} />
              </span>
              <span className="trace-num meta">
                {durationText(s.ms)}
                {typeof s.cost_usd === "number" ? `・${usdText(s.cost_usd)}` : ""}
                {s.ok ? "" : `・失敗${traceErrorLabel(s.error) ? `（${traceErrorLabel(s.error)}）` : ""}`}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
