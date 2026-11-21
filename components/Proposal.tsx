"use client";

import type { Candidate, Proposal as ProposalT } from "@/app/_client/types";
import { ACTIVITY_LABEL } from "./labels";
import { CopyButton, Tag } from "./ui";

/** All candidates in one surface, rows split by a thin line. The no-fit note sits at the bottom. */
export function Candidates({
  result,
  disabled,
  onApprove,
  onOpenCard,
}: {
  result: ProposalT;
  disabled: boolean;
  onApprove: (c: Candidate) => void;
  onOpenCard: (cardId: string, evidenceId?: string) => void;
}) {
  const n = result.candidates.length;
  return (
    <section className="surface cands" aria-labelledby="cands-title">
      <div className="cands-head">
        <h2 id="cands-title" className="h2">
          {n > 0 ? `候補 ${n}人` : "合う候補が見つかりませんでした"}
        </h2>
        <p className="small muted-strong">{result.summary}</p>
        {result.nominee_assessment && <p className="small muted-strong">指名された人：{result.nominee_assessment}</p>}
      </div>
      {result.candidates.map((c) => (
        <CandidateRow key={c.employee_id} c={c} disabled={disabled} onApprove={() => onApprove(c)} onOpenCard={(ev) => c.card_id && onOpenCard(c.card_id, ev)} />
      ))}
      <NoFit result={result} />
    </section>
  );
}

function CandidateRow({
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
    <article className="cand" aria-labelledby={`cand-${c.employee_id}`}>
      <div className="cand-head">
        <span className="rank" aria-label={`${c.rank}位`}>
          {c.rank}
        </span>
        <span id={`cand-${c.employee_id}`} className="cand-name">
          {c.name}
        </span>
        {c.is_nominee && <span className="nominee">指名</span>}
        {c.is_alternative_to_nominee && <span className="nominee">指名の代わり</span>}
        <span className="meta">
          {c.business_unit}・登壇{c.past_talk_count}回・{c.busy_text}
        </span>
        {conditional && <Tag tone="warn">条件付き</Tag>}
      </div>
      <p className="cand-theme">{c.theme}</p>
      {conditional && <p className="caveat">{c.caveat?.trim() || "引っかかる点の記載がありません。カードで確かめてください。"}</p>}
      <p className="cand-reason">
        {c.talk_tag && <span className="meta">{c.talk_tag}・</span>}
        {c.reason}
      </p>
      <p className="cand-evidence meta">
        根拠：
        {c.evidence_request_id && <span>依頼 {c.evidence_request_id}（指名）</span>}
        {c.evidence.map((ev, i) => (
          <span key={ev.id}>
            {(i > 0 || c.evidence_request_id) && "、"}
            {c.card_id ? (
              <button type="button" className="link" title={ev.title} onClick={() => onOpenCard(ev.id)}>
                {ACTIVITY_LABEL[ev.type] ?? ev.type} {ev.id}
              </button>
            ) : (
              `${ACTIVITY_LABEL[ev.type] ?? ev.type} ${ev.id}`
            )}
          </span>
        ))}
        {c.evidence.length === 0 && !c.evidence_request_id && "発信済みの記録"}
      </p>
      {c.cautions.length > 0 && (
        <p className="cautions meta" title={c.cautions.join("／")}>
          注意：{c.cautions.join("／")}
        </p>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn-primary btn-sm" onClick={onApprove} disabled={disabled}>
          この人で進める
        </button>
        {c.card_id && (
          <button type="button" className="btn btn-sm" onClick={() => onOpenCard()}>
            カードを見る
          </button>
        )}
      </div>
    </article>
  );
}

/** One small box under the candidates: why nobody else, and what to check next. */
function NoFit({ result }: { result: ProposalT }) {
  if (!result.no_fit) return null;
  const none = result.candidates.length === 0;
  return (
    <div className="nofit small">
      <h3 className="h4">{none ? "見つからない理由" : "ほかに見つからなかった理由"}</h3>
      <ul className="plain-list">
        {result.no_fit.reasons.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
      <h3 className="h4">次に確認すべきこと</h3>
      <ul className="plain-list">
        {result.no_fit.next_checks.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export function AlternativePitch({ text }: { text: string }) {
  const plain = text.replace(/\*\*(.+?)\*\*/g, "$1");
  return (
    <section className="surface pad-lg" aria-labelledby="pitch-title">
      <h2 id="pitch-title" className="h2">
        代わりの人を推す文（依頼元・本人への相談用）
      </h2>
      <p className="pre small">{plain}</p>
      <div className="btn-row">
        <CopyButton text={plain} />
      </div>
    </section>
  );
}
