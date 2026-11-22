"use client";

import { useState } from "react";
import type { BoardDetail, Candidate, DeclineReason, OutreachDraft, OutreachResult } from "@/app/_client/types";
import { StageTag } from "./Inbox";
import { REASON_LABEL, RESULT_LABEL } from "./labels";
import { CopyButton, ErrorLine, Spinner } from "./ui";
import { useUsedFeedback } from "@/app/_client/feedback";

/** After "この人で進める": the outreach draft (copy only, never sent) and the result buttons. */
export function Approved({
  candidate,
  draft,
  drafting,
  draftError,
  draftNote,
  resume = false,
  outreach = false,
  dateSentence = null,
  onBack,
  onRetryDraft,
  onRecord,
  onOutreachCopied,
}: {
  candidate: Candidate;
  draft: OutreachDraft | null;
  drafting: boolean;
  draftError: string | null;
  draftNote: string | null;
  /** 声かけ中の人の返事を記録しに戻ってきた（声かけ文は作り直さない） */
  resume?: boolean;
  /** もう声をかけた人（声かけ文をコピーした）。まだなら「下書き中」 */
  outreach?: boolean;
  /** 声かけ文をコピーしたとき（ここで「声かけ中」にする） */
  onOutreachCopied?: () => void;
  /** 主催者への返事に入れてよい「空いていそうな日」の1文（日程が未定の依頼で、日が見つかったときだけ） */
  dateSentence?: string | null;
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
          <span className="cand-name">{resume || outreach ? `${candidate.name}さんに声かけ中` : `${candidate.name}さんで進める`}</span>
          <span className="meta">
            {[candidate.business_unit, candidate.talk_tag ?? `登壇${candidate.past_talk_count}回`, candidate.busy_text].filter((x) => x && String(x).trim()).join("・")}
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
      {draft && <DraftEditor key={candidate.employee_id} draft={draft} note={draftNote} employeeId={candidate.employee_id} outreach={outreach} onCopied={onOutreachCopied} />}
      {draft?.organizer_reply && (
        <OrganizerReply key={`reply-${candidate.employee_id}`} text={draft.organizer_reply} note={draft.organizer_reply_note ?? null} dateSentence={dateSentence} employeeId={candidate.employee_id} />
      )}
      {resume && !draft && !drafting && (
        <section className="surface pad-lg">
          <p className="meta">声かけ文は前に作ったものを使ってください。作り直すこともできます。</p>
          <button type="button" className="btn btn-sm" onClick={onRetryDraft}>
            声かけ文をもう一度作る
          </button>
        </section>
      )}
      {(draft || resume) && <OutcomeRecorder name={candidate.name} onRecord={onRecord} />}
    </>
  );
}

/**
 * 承諾済みの依頼の画面：候補の一覧は出さず、決まった人・状態・開催日・主催者への返事の下書きを出す。
 * 候補の一覧は「ほかの候補を見る」で開ける。
 */
export function AcceptedView({
  detail,
  reply,
  dateSentence = null,
  showOthers,
  onToggleOthers,
  onOpenCard,
  onUndo,
}: {
  detail: BoardDetail;
  reply: { name: string; text: string; employee_id?: string } | null;
  /** 決まった人の「空いていそうな日」の1文（あれば） */
  dateSentence?: string | null;
  showOthers: boolean;
  onToggleOthers: () => void;
  onOpenCard: (employeeId: string) => void;
  /** 承諾の取り消し（記録を1つ戻す） */
  onUndo: (employeeId: string) => Promise<void>;
}) {
  const st = detail.state;
  const [undoFor, setUndoFor] = useState<string | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  return (
    <>
      <section className="surface pad-lg" aria-labelledby="acc-title">
        <p className="meta inbox-marks">
          <StageTag stage={st.stage} />
          {detail.event_date ? <span>開催日 {detail.event_date}</span> : <span>開催日は未定</span>}
        </p>
        <h3 id="acc-title" className="h2">
          決まった人
        </h3>
        <ul className="plain-list">
          {st.accepted_by.map((p) => (
            <li key={p.employee_id}>
              <button type="button" className="link cand-name" onClick={() => onOpenCard(p.employee_id)}>
                {p.name}さん
              </button>
              <span className="meta">　承諾済み</span>
              {"　"}
              {undoFor === p.employee_id ? (
                <span className="btn-row" style={{ display: "inline-flex" }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={undoBusy}
                    onClick={async () => {
                      setUndoBusy(true);
                      setUndoError(null);
                      try {
                        await onUndo(p.employee_id);
                        setUndoFor(null);
                      } catch (err) {
                        setUndoError(`${err instanceof Error ? err.message : "取り消せませんでした"}。`);
                      }
                      setUndoBusy(false);
                    }}
                  >
                    {undoBusy ? "取り消しています…" : "承諾の記録を取り消す"}
                  </button>
                  <button type="button" className="link" disabled={undoBusy} onClick={() => setUndoFor(null)}>
                    やめる
                  </button>
                </span>
              ) : (
                <button type="button" className="link" onClick={() => setUndoFor(p.employee_id)}>
                  承諾を取り消す
                </button>
              )}
            </li>
          ))}
        </ul>
        {st.declined_by.length > 0 && <p className="meta">辞退：{st.declined_by.map((p) => `${p.name}さん`).join("・")}</p>}
        {undoFor && <p className="meta">取り消すと、承諾の記録を1つ戻して、承諾の前の状態（「声かけ中」か「下書き中」）に戻ります。</p>}
        <ErrorLine message={undoError} />
        <div className="btn-row">
          <button type="button" className="btn btn-sm" aria-expanded={showOthers} onClick={onToggleOthers}>
            {showOthers ? "ほかの候補を閉じる" : "ほかの候補を見る"}
          </button>
        </div>
      </section>
      {reply ? (
        <OrganizerReply key={`acc-reply-${reply.name}`} text={reply.text} note={null} accepted employeeId={reply.employee_id ?? null} />
      ) : (
        <section className="surface pad-lg">
          <h3 className="h3">主催者への返事（下書き）</h3>
          <p className="meta">保存された下書きがありません（声かけ文を作ったときに一緒に作られます）。</p>
        </section>
      )}
    </>
  );
}

/** 主催者への返事（X で返す短い文）。送信はしない。直してコピーするだけ */
function OrganizerReply({
  text,
  note,
  accepted = false,
  dateSentence = null,
  employeeId = null,
}: {
  text: string;
  note: string | null;
  accepted?: boolean;
  /** 使われた結果（good／edited）を送るときの、返事の相手の人 */
  employeeId?: string | null;
  /** 「この日あたりなら調整しやすそうです（本人に確認します）」の1文。ボタンを押したときだけ本文に入れる */
  dateSentence?: string | null;
}) {
  const [value, setValue] = useState(text);
  // コピーしたら「使った」として、直していなければ good、直していれば edited を送る（確認の窓は出さない）
  const used = useUsedFeedback("reply", employeeId, text);
  const hasDate = !!dateSentence && value.includes(dateSentence);
  return (
    <section className="surface pad-lg" aria-labelledby="reply-title">
      <h3 id="reply-title" className="h3">
        主催者への返事（下書き）
      </h3>
      <p className="meta">
        {accepted
          ? "声をかけたときに作った下書きです（本人に確認する前の書き方）。承諾をもらえたので、言い回しを直してからコピーし、X で返信してください。ここからは送信しません。"
          : "X で返す短い文です。本人にはまだ確認していない前提の書き方です。ここからは送信しません。直してコピーし、X で返信してください。"}
      </p>
      {note && <p className="log-line log-warn">{note}</p>}
      <label className="field">
        <span className="field-label">本文（{value.length}字）</span>
        <textarea className="input reply-text" rows={4} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <div className="btn-row">
        <CopyButton text={value} label="返事をコピー" primary onCopied={used.onUsed} />
        {dateSentence && (
          <button
            type="button"
            className="btn"
            disabled={hasDate}
            title={dateSentence}
            onClick={() => setValue((v) => `${v.trimEnd()}${v.trimEnd().endsWith("。") || v.trimEnd().endsWith("！") ? "" : "。"}${dateSentence}`)}
          >
            {hasDate ? "空いていそうな日を入れました" : "空いていそうな日を入れる"}
          </button>
        )}
        <button type="button" className="btn" disabled={value === text} onClick={() => setValue(text)}>
          最初の下書きに戻す
        </button>
      </div>
      {used.note && (
        <p className="meta feedback-note" role="status">
          {used.note}
        </p>
      )}
      {dateSentence && !hasDate && <p className="meta">入れる文：{dateSentence}（本人に確認する前の目安。押したときだけ入れます）</p>}
    </section>
  );
}

function DraftEditor({ draft, note, employeeId, outreach = false, onCopied }: { draft: OutreachDraft; note: string | null; employeeId: string; outreach?: boolean; onCopied?: () => void }) {
  const [subject, setSubject] = useState(draft.subject);
  const [message, setMessage] = useState(draft.message);
  // コピーしたら「使った」として、直していなければ good、直していれば edited を送る（直す前と後の件名＋本文）
  const used = useUsedFeedback("draft", employeeId, `${draft.subject}\n\n${draft.message}`);
  const edited = subject !== draft.subject || message !== draft.message;
  const outlineText = draft.lt_outline.map((s) => `${s.minutes}分　${s.heading}\n${s.points.map((p) => `・${p}`).join("\n")}`).join("\n");

  return (
    <>
      {/* 読む前にコピーしてしまわないよう、「声をかける前に」を声かけ文の上に置く */}
      {draft.tips_for_pr.length > 0 && (
        <section className="surface pad-lg tips" aria-labelledby="tips-title">
          <h3 id="tips-title" className="h3">
            声をかける前に
          </h3>
          <ul className="plain-list small">
            {draft.tips_for_pr.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}
      <section className="surface pad-lg" aria-labelledby="draft-title">
        <div className="row-between">
          <h3 id="draft-title" className="h3">
            声かけ文（下書き）
          </h3>
        </div>
        <p className="meta">
          自分の言葉に直して、コピーして送ってください（ここからは送信しません）。
          {outreach ? "声かけ中として記録済みです。" : "コピーすると、この依頼は「声かけ中」になります（それまでは「下書き中」）。"}
        </p>
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
          <CopyButton
            text={`${subject}\n\n${message}`}
            label="声かけ文をコピー"
            primary
            onCopied={(t) => {
              used.onUsed(t);
              onCopied?.();
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={!edited}
            onClick={() => {
              setSubject(draft.subject);
              setMessage(draft.message);
            }}
          >
            最初の下書きに戻す
          </button>
        </div>
        {used.note && (
          <p className="meta feedback-note" role="status">
            {used.note}
          </p>
        )}
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
