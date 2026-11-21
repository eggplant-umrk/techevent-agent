"use client";

import { useEffect, useRef, useState } from "react";
import type { DraftResponse } from "@/app/_client/api";
import type { CardFormat, CardPatch, NotebookCard, VenueDraftBody, VenueEvent } from "@/app/_client/types";
import { VenueFinder } from "./VenueFinder";
import { ACTIVITY_LABEL, FIELD_LABEL, FORMAT_LABEL, md, REASON_LABEL, RESULT_LABEL } from "./labels";
import { CardMarks, ErrorLine, statusText, Tag } from "./ui";

/** Card detail as a side sheet (full screen on a phone). Native <dialog>: Esc closes, focus stays inside.
 *  外側（暗い部分）のクリックでも閉じる。書きかけの入力があるときは、外側クリックでも Esc でも閉じない（×は閉じる）。 */
export function CardDetail({
  card,
  focusEvidence,
  onClose,
  onSave,
  onResolve,
  onFindVenues,
  onVenueDraft,
}: {
  card: NotebookCard;
  focusEvidence: string | null;
  onClose: () => void;
  onSave: (patch: CardPatch) => Promise<void>;
  onResolve: (theme: string, accept: boolean) => Promise<void>;
  /** カード → 出し先を探す（渡されたときだけボタンを出す） */
  onFindVenues?: (cardId: string, onEvent: (e: VenueEvent) => void) => Promise<void>;
  onVenueDraft?: (body: VenueDraftBody) => Promise<DraftResponse>;
}) {
  const [venueDirty, setVenueDirty] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openEv, setOpenEv] = useState<string | null>(focusEvidence);
  const [summary, setSummary] = useState(card.summary);
  const [themes, setThemes] = useState(card.themes.join("\n"));
  const [format, setFormat] = useState<CardFormat>(card.format);
  const [formatReason, setFormatReason] = useState(card.format_reason);
  const e = card.employee;
  // 外側（暗い部分）での押し始めを覚えておく。中で文字を選んで外で離したときに閉じないように
  const pressedOutside = useRef(false);
  /** 編集中で、元の内容から書き換えた入力があるか */
  const dirty =
    (editing &&
      (summary !== card.summary || themes !== card.themes.join("\n") || format !== card.format || formatReason !== card.format_reason)) ||
    venueDirty; // 出し先の声かけ文を書き換えたときも書きかけとして扱う

  /** クリック位置がパネルの外（::backdrop）か。<dialog> 自身が target になるので位置で判定する */
  function isOutside(ev: React.MouseEvent<HTMLDialogElement>) {
    const d = ref.current;
    if (!d || ev.target !== d) return false;
    const r = d.getBoundingClientRect();
    return ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
  }

  const KEEP_OPEN = "書きかけの内容があるので閉じませんでした。保存するか「やめる」を押してから閉じてください。";

  function onBackdropClick(ev: React.MouseEvent<HTMLDialogElement>) {
    const outside = pressedOutside.current && isOutside(ev);
    pressedOutside.current = false;
    if (!outside) return;
    if (dirty) {
      setError(KEEP_OPEN);
      return;
    }
    ref.current?.close(); // onClose が呼ばれる（Esc・×と同じ閉じ方）
  }

  /** Esc（<dialog> の cancel）。書きかけがあるときは外側クリックと同じく閉じない */
  function onCancel(ev: React.SyntheticEvent<HTMLDialogElement>) {
    if (!dirty) return;
    ev.preventDefault();
    setError(KEEP_OPEN);
  }

  /** Chrome は cancel を止められるのが1回までで、続けて Esc を押すと閉じてしまう。キーの段階で止める */
  function onKeyDown(ev: React.KeyboardEvent<HTMLDialogElement>) {
    if (ev.key !== "Escape" || !dirty) return;
    ev.preventDefault();
    setError(KEEP_OPEN);
  }

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => setOpenEv(focusEvidence), [focusEvidence, card.card_id]);
  useEffect(() => {
    setSummary(card.summary);
    setThemes(card.themes.join("\n"));
    setFormat(card.format);
    setFormatReason(card.format_reason);
  }, [card]);
  useEffect(() => {
    if (focusEvidence) document.getElementById(`ev-${focusEvidence}`)?.scrollIntoView({ block: "center" });
  }, [focusEvidence]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "保存できませんでした"}。内容を確かめて、もう一度押してください。`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const list = themes.split("\n").map((s) => s.trim()).filter(Boolean);
    if (list.length === 0 || list.length > 3) return setError("テーマ案は1〜3個にしてください。");
    if (await run(() => onSave({ summary, themes: list, format, format_reason: formatReason }))) setEditing(false);
  }

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="cd-title"
      onClose={onClose}
      onCancel={onCancel}
      onKeyDown={onKeyDown}
      onMouseDown={(ev) => (pressedOutside.current = isOutside(ev))}
      onClick={onBackdropClick}
    >
      <div className="sheet-head">
        <div className="sheet-title">
          <h2 id="cd-title" className="h2">
            {e?.name ?? card.employee_id}
          </h2>
          <p className="meta">
            {e?.business_unit}・{e?.role}・登壇{e?.past_talk_count ?? 0}回{e?.last_talk_date ? `（最終 ${e.last_talk_date}）` : ""}・忙しさ{e?.workload}
          </p>
          <div className="tags">
            <CardMarks card={card} />
            <span className="meta">{statusText(card)}</span>
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="カードを閉じる" onClick={() => ref.current?.close()}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="sheet-body">
        {card.pending_themes.length > 0 && (
          <section className="block" aria-labelledby="cd-pending">
            <h3 id="cd-pending" className="h3">
              <Tag tone="warn">新しいテーマ案（未確認）</Tag>
            </h3>
            <ul className="pending-list">
              {card.pending_themes.map((t) => (
                <li key={t}>
                  <span className="strong">{t}</span>
                  <span className="btn-row">
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => run(() => onResolve(t, true))}>
                      採用
                    </button>
                    <button type="button" className="btn btn-sm" disabled={busy} onClick={() => run(() => onResolve(t, false))}>
                      却下
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!editing ? (
          <>
            <section className="block">
              <h3 className="h3">取り組みの要約</h3>
              <p>{card.summary}</p>
            </section>
            <section className="block">
              <h3 className="h3">話せるテーマ案</h3>
              <ol className="theme-list">
                {card.themes.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
            </section>
            <section className="block">
              <h3 className="h3">おすすめの形</h3>
              <p>
                <span className="strong">{FORMAT_LABEL[card.format]}</span>　{card.format_reason}
              </p>
            </section>
          </>
        ) : (
          <section className="block edit" aria-label="カードを直す">
            <p className="meta">直した項目はAgentが上書きしません。</p>
            <label className="field">
              <span className="field-label">取り組みの要約</span>
              <textarea className="input" rows={4} value={summary} onChange={(ev) => setSummary(ev.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">話せるテーマ案（1行に1つ、3つまで）</span>
              <textarea className="input" rows={3} value={themes} onChange={(ev) => setThemes(ev.target.value)} />
            </label>
            <fieldset className="field">
              <legend className="field-label">おすすめの形</legend>
              <div className="seg">
                {(Object.keys(FORMAT_LABEL) as CardFormat[]).map((f) => (
                  <button key={f} type="button" className="chip" aria-pressed={format === f} onClick={() => setFormat(f)}>
                    {FORMAT_LABEL[f]}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span className="field-label">その形をすすめる理由</span>
              <input className="input" value={formatReason} onChange={(ev) => setFormatReason(ev.target.value)} />
            </label>
          </section>
        )}

        <section className="block">
          <h3 className="h3">根拠の投稿</h3>
          {card.evidence.length === 0 &&
            (card.evidence_request_ids?.length ? (
              <p className="meta">指名の依頼（{card.evidence_request_ids.join("、")}）がもとになっているカードです。取り組みの投稿はまだありません。</p>
            ) : (
              <p className="meta">発信済みの記録がもとになっているカードです。</p>
            ))}
          <ul className="ev-list">
            {card.evidence.map((ev) => (
              <li key={ev.id} id={`ev-${ev.id}`} className={openEv === ev.id ? "is-open" : undefined}>
                <button type="button" className="ev-head" aria-expanded={openEv === ev.id} onClick={() => setOpenEv(openEv === ev.id ? null : ev.id)}>
                  <span className="meta ev-kind">{ACTIVITY_LABEL[ev.type] ?? ev.type}</span>
                  <span className="grow">{ev.title}</span>
                  <span className="meta">{ev.date}</span>
                </button>
                {openEv === ev.id && (
                  <div className="ev-body">
                    <p>{ev.body}</p>
                    <p className="meta">
                      {ev.id}
                      {ev.where && `・${ev.where}`}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        {(card.published.length > 0 || card.announcements.length > 0) && (
          <section className="block">
            <h3 className="h3">発信の記録</h3>
            <ul className="plain-list">
              {card.published.map((p) => (
                <li key={p.id}>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer">
                      {p.title}
                    </a>
                  ) : (
                    p.title
                  )}
                  <span className="meta">　{p.genre}・{p.date}</span>
                </li>
              ))}
              {card.announcements.map((a) => (
                <li key={a.id} className="meta">
                  告知：{a.title}（{a.date}）
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="block">
          <h3 className="h3">打診履歴</h3>
          {card.outreach_history.length === 0 ? (
            <p className="meta">まだありません。</p>
          ) : (
            <ul className="history">
              {card.outreach_history.map((h, i) => (
                <li key={i}>
                  <span className="meta">{md(h.date)}</span>
                  <span>{h.request_id}</span>
                  <Tag tone={h.result === "declined" ? "warn" : h.result === "approved" ? "neutral" : "ok"}>
                    {RESULT_LABEL[h.result]}
                    {h.reason && `：${REASON_LABEL[h.reason]}`}
                  </Tag>
                  {h.event_date && <span className="meta">開催 {h.event_date}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {onFindVenues && onVenueDraft && (
          <VenueFinder
            cardId={card.card_id}
            employeeName={e?.name ?? card.employee_id}
            onFind={onFindVenues}
            onDraft={onVenueDraft}
            onDirtyChange={setVenueDirty}
          />
        )}

        <p className="meta">
          作成 {card.created_at.slice(0, 10)}・更新 {card.updated_at.slice(0, 10)}
          {card.edited_fields.length > 0 && `・人が直した項目：${card.edited_fields.map((f) => FIELD_LABEL[f] ?? f).join("、")}`}
        </p>
      </div>

      <div className="sheet-foot">
        <ErrorLine message={error} />
        <div className="btn-row">
          {!editing ? (
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              カードを直す
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={save}>
                {busy ? "保存しています…" : "保存して確認済みにする"}
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => setEditing(false)}>
                やめる
              </button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
