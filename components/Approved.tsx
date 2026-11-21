"use client";

import { useState } from "react";
import type { Candidate, DeclineReason, OutreachDraft, OutreachResult } from "@/app/_client/types";
import { REASON_LABEL, RESULT_LABEL } from "./labels";
import { CopyButton, ErrorLine, Spinner } from "./ui";

/** After "この人で進める": the outreach draft (copy only, never sent) and the result buttons. */
export function Approved({
  candidate,
  draft,
  drafting,
  draftError,
  draftNote,
  onBack,
  onRetryDraft,
  onRecord,
}: {
  candidate: Candidate;
  draft: OutreachDraft | null;
  drafting: boolean;
  draftError: string | null;
  draftNote: string | null;
  onBack: () => void;
  onRetryDraft: () => void;
  onRecord: (r: OutreachResult, reason?: DeclineReason) => Promise<void>;
}) {
  return (
    <>
      <section className="surface pad-lg" aria-label="進める人">
        <div className="cand-head">
          <button type="button" className="link" onClick={onBack}>
            ← 候補に戻る
          </button>
        </div>
        <div className="cand-head">
          <span className="cand-name">{candidate.name}さんで進める</span>
          <span className="meta">
            {candidate.business_unit}・登壇{candidate.past_talk_count}回・忙しさ{candidate.workload}
          </span>
        </div>
        <p className="cand-theme">{candidate.theme}</p>
        {candidate.confidence === "conditional" && (
          <p className="caveat">条件付き：{candidate.caveat?.trim() || "引っかかる点の記載がありません"}</p>
        )}
      </section>

      {drafting && (
        <section className="surface pad-lg">
          <Spinner label={`${candidate.name}さんへの声かけ文を作っています…`} />
        </section>
      )}
      {draftError && (
        <section className="surface pad-lg">
          <ErrorLine message={draftError} />
          <button type="button" className="btn" onClick={onRetryDraft}>
            もう一度作る
          </button>
        </section>
      )}
      {draft && <DraftEditor key={candidate.employee_id} draft={draft} note={draftNote} />}
      {draft?.organizer_reply && <OrganizerReply key={`reply-${candidate.employee_id}`} text={draft.organizer_reply} note={draft.organizer_reply_note ?? null} />}
      {draft && <OutcomeRecorder name={candidate.name} onRecord={onRecord} />}
    </>
  );
}

/** 主催者への返事（X で返す短い文）。送信はしない。直してコピーするだけ */
function OrganizerReply({ text, note }: { text: string; note: string | null }) {
  const [value, setValue] = useState(text);
  return (
    <section className="surface pad-lg" aria-labelledby="reply-title">
      <h3 id="reply-title" className="h3">
        主催者への返事（下書き）
      </h3>
      <p className="meta">X で返す短い文です。本人にはまだ確認していない前提の書き方です。ここからは送信しません。直してコピーし、X で返信してください。</p>
      {note && <p className="log-line log-warn">{note}</p>}
      <label className="field">
        <span className="field-label">本文（{value.length}字）</span>
        <textarea className="input reply-text" rows={4} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="btn-row">
        <CopyButton text={value} label="返事をコピー" primary />
        <button type="button" className="btn" disabled={value === text} onClick={() => setValue(text)}>
          下書きに戻す
        </button>
      </div>
    </section>
  );
}

function DraftEditor({ draft, note }: { draft: OutreachDraft; note: string | null }) {
  const [subject, setSubject] = useState(draft.subject);
  const [message, setMessage] = useState(draft.message);
  const edited = subject !== draft.subject || message !== draft.message;
  const outlineText = draft.lt_outline.map((s) => `${s.minutes}分　${s.heading}\n${s.points.map((p) => `・${p}`).join("\n")}`).join("\n");

  return (
    <>
      <section className="surface pad-lg" aria-labelledby="draft-title">
        <div className="row-between">
          <h3 id="draft-title" className="h3">
            声かけ文（下書き）
          </h3>
        </div>
        <p className="meta">自分の言葉に直して、コピーして送ってください（ここからは送信しません）。</p>
        {note && <p className="log-line log-warn">{note}</p>}
        <label className="field">
          <span className="field-label">件名</span>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">本文</span>
          <textarea className="input draft-text" rows={14} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <div className="btn-row">
          <CopyButton text={`${subject}\n\n${message}`} label="声かけ文をコピー" primary />
          <button
            type="button"
            className="btn"
            disabled={!edited}
            onClick={() => {
              setSubject(draft.subject);
              setMessage(draft.message);
            }}
          >
            下書きに戻す
          </button>
        </div>
      </section>

      <section className="surface pad-lg" aria-labelledby="outline-title">
        <div className="row-between">
          <h3 id="outline-title" className="h3">
            LT構成案
          </h3>
          <span className="meta">合計 {draft.lt_outline.reduce((s, x) => s + x.minutes, 0)}分</span>
        </div>
        <ol className="outline">
          {draft.lt_outline.map((s, i) => (
            <li key={i}>
              <span className="mins">{s.minutes}分</span>
              <div>
                <p className="strong">{s.heading}</p>
                <ul className="plain-list small">
                  {s.points.map((p, j) => (
                    <li key={j}>{p}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
        <div className="btn-row">
          <CopyButton text={outlineText} label="構成案をコピー" />
        </div>
        {draft.tips_for_pr.length > 0 && (
          <div className="tips">
            <h4 className="h4">声をかける前に</h4>
            <ul className="plain-list small">
              {draft.tips_for_pr.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}

function OutcomeRecorder({ name, onRecord }: { name: string; onRecord: (r: OutreachResult, reason?: DeclineReason) => Promise<void> }) {
  const [choice, setChoice] = useState<"accepted" | "declined" | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function record(r: OutreachResult, reason?: DeclineReason) {
    setBusy(true);
    setError(null);
    try {
      await onRecord(r, reason);
      setSaved((s) => [...s, `${RESULT_LABEL[r]}${reason ? `（${REASON_LABEL[reason]}）` : ""}`]);
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "記録できませんでした"}。もう一度押してください。`);
    } finally {
      setBusy(false);
    }
  }

  const accepted = saved.some((s) => s.startsWith("承諾"));
  const published = saved.some((s) => s.startsWith("公開"));
  const declined = saved.some((s) => s.startsWith("辞退"));

  return (
    <section className="surface pad-lg" aria-labelledby="outcome-title">
      <h3 id="outcome-title" className="h3">
        結果の記録
      </h3>
      <p className="meta">返事をカードの打診履歴に書き戻します。</p>
      <div role="group" aria-label="返事" className="btn-row">
        <button
          type="button"
          className="btn"
          aria-pressed={choice === "accepted"}
          disabled={busy || accepted || declined}
          onClick={() => {
            setChoice("accepted");
            record("accepted");
          }}
        >
          承諾
        </button>
        <button type="button" className="btn" aria-pressed={choice === "declined"} disabled={busy || accepted || declined} onClick={() => setChoice("declined")}>
          辞退
        </button>
      </div>
      {choice === "declined" && !declined && (
        <div className="reason-pick">
          <p className="field-label">辞退の理由</p>
          <div role="group" aria-label="辞退の理由" className="btn-row">
            {(Object.keys(REASON_LABEL) as DeclineReason[]).map((r) => (
              <button key={r} type="button" className="btn" disabled={busy} onClick={() => record("declined", r)}>
                {REASON_LABEL[r]}
              </button>
            ))}
          </div>
        </div>
      )}
      {accepted && !published && (
        <div className="reason-pick">
          <p className="field-label">登壇やブログが公開されたら</p>
          <button type="button" className="btn" disabled={busy} onClick={() => record("published")}>
            公開した
          </button>
        </div>
      )}
      <ErrorLine message={error} />
      {saved.length > 0 && (
        <p className="ok-line small" role="status">
          記録しました：{saved.join("、")}
        </p>
      )}
    </section>
  );
}
