"use client";

import type { DeclineReason, NotebookCard, SpeakingRequest } from "@/app/_client/types";
import { FIELD_LABEL, md, PATTERN_LABEL, REASON_LABEL, RESULT_LABEL } from "./labels";
import { Tag } from "./ui";

/** 依頼の履歴: every request with what was written back to the cards for it. */
export function HistoryView({ presets, cards, onOpen }: { presets: SpeakingRequest[]; cards: NotebookCard[]; onOpen: (id: string) => void }) {
  const rows = cards.flatMap((c) => c.outreach_history.map((h) => ({ ...h, card: c })));
  const ids = [...new Set([...presets.map((p) => p.id), ...rows.map((r) => r.request_id)])];

  return (
    <section className="surface pad-lg wide" aria-labelledby="hist-title">
      <h2 id="hist-title" className="h2">
        依頼の履歴
      </h2>
      <p className="small">承認・承諾・辞退・公開の記録は、それぞれのカードの打診履歴に残っています。ここでは依頼ごとにまとめて見られます。</p>
      <ul className="hist">
        {ids.map((id) => {
          const p = presets.find((x) => x.id === id);
          const entries = rows.filter((r) => r.request_id === id);
          return (
            <li key={id} className="hist-item">
              <div className="tags">
                {p && <Tag tone="accent">{PATTERN_LABEL[p.pattern ?? ""] ?? p.pattern}</Tag>}
                <span className="meta">
                  {id}
                  {p?.event?.date ? `・開催 ${p.event.date}` : ""}
                </span>
              </div>
              <p className="strong">{p?.event?.title ?? "貼り付けた依頼"}</p>
              {entries.length === 0 ? (
                <p className="meta">まだ記録がありません。</p>
              ) : (
                <ul className="history">
                  {entries.map((e, i) => (
                    <li key={i}>
                      <span className="meta">{md(e.date)}</span>
                      <button type="button" className="link" onClick={() => onOpen(e.card.card_id)}>
                        {e.card.employee?.name}
                      </button>
                      <Tag tone={e.result === "declined" ? "warn" : e.result === "approved" ? "neutral" : "ok"}>
                        {RESULT_LABEL[e.result]}
                        {e.reason && `：${REASON_LABEL[e.reason]}`}
                      </Tag>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const NEXT_TIME: Record<DeclineReason, string> = {
  theme_mismatch: "同じ方向のテーマでは候補の順位を下げる",
  busy: "近い時期の依頼では、忙しさを先に確認して順位を下げる",
  schedule_conflict: "開催日の前後の予定を必ず確認する",
  other: "理由をSlackで確かめてから次に声をかける",
};

/** Agentの学び: what the agent will read next time (declines on cards, fields people fixed). */
export function LearningsView({ cards, onOpen }: { cards: NotebookCard[]; onOpen: (id: string) => void }) {
  const declines = cards.flatMap((c) => c.outreach_history.filter((h) => h.result === "declined").map((h) => ({ ...h, card: c })));
  const reviewed = cards.filter((c) => c.reviewed);

  return (
    <div className="stack wide">
      <section className="surface pad-lg" aria-labelledby="learn-decline">
        <h2 id="learn-decline" className="h2">
          辞退から学んだこと
        </h2>
        <p className="small">辞退の理由はカードに書き戻され、次の提案でAgentが読みます。</p>
        {declines.length === 0 ? (
          <p className="meta">まだ辞退の記録はありません。</p>
        ) : (
          <ul className="learn-list">
            {declines.map((d, i) => (
              <li key={i}>
                <div className="tags">
                  <Tag tone="warn">辞退：{d.reason ? REASON_LABEL[d.reason] : "理由なし"}</Tag>
                  <span className="meta">
                    {md(d.date)}・{d.request_id}
                  </span>
                </div>
                <p>
                  <button type="button" className="link" onClick={() => onOpen(d.card.card_id)}>
                    {d.card.employee?.name}
                  </button>
                  ：{d.reason ? NEXT_TIME[d.reason] : NEXT_TIME.other}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="surface pad-lg" aria-labelledby="learn-reviewed">
        <h2 id="learn-reviewed" className="h2">
          人が直したカード
        </h2>
        <p className="small">直した項目は、Agentが活動を読み直しても上書きしません。根拠の追加と最新の活動日だけ更新します。</p>
        {reviewed.length === 0 ? (
          <p className="meta">まだ人が直したカードはありません。</p>
        ) : (
          <ul className="learn-list">
            {reviewed.map((c) => (
              <li key={c.card_id}>
                <div className="tags">
                  <Tag tone="ok">確認済み</Tag>
                  {c.pending_themes.length > 0 && <Tag tone="warn">新しいテーマ案（未確認） {c.pending_themes.length}</Tag>}
                </div>
                <p>
                  <button type="button" className="link" onClick={() => onOpen(c.card_id)}>
                    {c.employee?.name}
                  </button>
                  ：{c.edited_fields.map((f) => FIELD_LABEL[f] ?? f).join("、") || "内容を確認"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
