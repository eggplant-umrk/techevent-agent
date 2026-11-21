"use client";

import type { Candidate, Proposal as ProposalT } from "@/app/_client/types";
import { ACTIVITY_LABEL, STATUS_LABEL } from "./labels";
import { CopyButton, Tag } from "./ui";

export function CandidateCardView({
  c,
  onApprove,
  onOpenCard,
  disabled,
}: {
  c: Candidate;
  onApprove: () => void;
  onOpenCard: (evidenceId?: string) => void;
  disabled: boolean;
}) {
  const conditional = c.confidence === "conditional";
  return (
    <article className={`surface pad-lg cand${conditional ? " is-conditional" : ""}`} aria-labelledby={`cand-${c.employee_id}`}>
      <div className="cand-head">
        <span className="rank" aria-label={`${c.rank}位`}>
          {c.rank}
        </span>
        <span id={`cand-${c.employee_id}`} className="cand-name">
          {c.name}
        </span>
        <span className="meta">
          {c.business_unit}・登壇{c.past_talk_count}回・忙しさ{c.workload}
        </span>
        <span className="tags">
          {conditional ? <Tag tone="warn">条件付きの候補</Tag> : <Tag tone="ok">自信のある候補</Tag>}
          {c.is_nominee && <Tag tone="accent">指名された本人</Tag>}
          {c.is_alternative_to_nominee && <Tag tone="accent">代わりの提案</Tag>}
          {c.card?.reviewed && <Tag tone="ok">確認済み</Tag>}
          {c.card && <Tag tone={c.card.publication_status === "unpublished" ? "warn" : "neutral"}>{STATUS_LABEL[c.card.publication_status]}</Tag>}
          {!c.card && <Tag>カードなし</Tag>}
        </span>
      </div>
      <p className="cand-theme">{c.theme}</p>
      {conditional && (
        <p className="caveat">
          <span className="strong">引っかかる点</span>
          <span>{c.caveat?.trim() || "（Agentが理由を書いていません。カードを見て確かめてください）"}</span>
        </p>
      )}
      <p className="cand-reason">{c.reason}</p>
      <div className="tags">
        <span className="meta">根拠</span>
        {c.evidence_request_id && <span className="tag tag-accent">依頼 {c.evidence_request_id}（指名）</span>}
        {c.evidence.map((ev) => (
          <button
            key={ev.id}
            type="button"
            className="ev-link"
            title={ev.title}
            onClick={() => onOpenCard(ev.id)}
            disabled={!c.card_id}
          >
            {ev.id} {ACTIVITY_LABEL[ev.type] ?? ev.type}
          </button>
        ))}
        {c.evidence.length === 0 && !c.evidence_request_id && <span className="meta">発信済みの記録</span>}
      </div>
      {c.cautions.length > 0 && (
        <ul className="cautions" aria-label="注意点">
          {c.cautions.map((w) => (
            <li key={w}>
              <span className="tag tag-warn tag-wrap">
                <span className="strong">注意</span>
                {w}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-primary" onClick={onApprove} disabled={disabled}>
          この人で進める
        </button>
        {c.card_id && (
          <button type="button" className="btn" onClick={() => onOpenCard()}>
            カードを見る
          </button>
        )}
      </div>
    </article>
  );
}

/** Puts a small label before the first strong and the first conditional candidate. */
export function CandidateGroup({ first, conditional, children }: { first: boolean; conditional: boolean; children: React.ReactNode }) {
  return (
    <>
      {first && (
        <p className="group-label">
          {conditional ? "条件付きの候補：引っかかる点を確かめてから声をかけてください" : "自信のある候補"}
        </p>
      )}
      {children}
    </>
  );
}

/** Summary, nominee check, what was learned from past outreach. */
export function ProposalNotes({ result }: { result: ProposalT }) {
  return (
    <section className="surface pad-lg notes" aria-labelledby="notes-title">
      <h3 id="notes-title" className="h3">
        Agentのまとめ
      </h3>
      <p>{result.summary}</p>
      {result.nominee_assessment && (
        <div>
          <h4 className="h4">指名された人の確認</h4>
          <p className="small">{result.nominee_assessment}</p>
        </div>
      )}
      {result.learnings_applied.length > 0 && (
        <div>
          <h4 className="h4">カードの打診履歴から反映したこと</h4>
          <ul className="plain-list small">
            {result.learnings_applied.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** No fit: do not pad the list. Say why, and what to check next. */
export function NoFit({ result }: { result: ProposalT }) {
  if (!result.no_fit) return null;
  const none = result.candidates.length === 0;
  return (
    <section className="surface pad-lg nofit" aria-labelledby="nofit-title">
      <div className="tags">
        <Tag tone="warn">{none ? "候補なし" : `候補は${result.candidates.length}人だけ`}</Tag>
      </div>
      <h3 id="nofit-title" className="h3">
        {none ? "合う候補が見つかりませんでした" : `候補は${result.candidates.length}人でした。無理に3人にはしていません`}
      </h3>
      <div className="nofit-cols">
        <div>
          <h4 className="h4">{none ? "見つからない理由" : "ほかに見つからなかった理由"}</h4>
          <ul className="plain-list small">
            {result.no_fit.reasons.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="h4">次に確認すべきこと</h4>
          <ol className="check-list small">
            {result.no_fit.next_checks.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function AlternativePitch({ text }: { text: string }) {
  return (
    <section className="surface pad-lg" aria-labelledby="pitch-title">
      <h3 id="pitch-title" className="h3">
        代わりの人を推す理由（依頼元・本人への相談用）
      </h3>
      <p className="pre small">{text}</p>
      <div className="btn-row">
        <CopyButton text={text} />
      </div>
    </section>
  );
}
