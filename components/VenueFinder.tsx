"use client";

import { useEffect, useState } from "react";
import type { DraftResponse } from "@/app/_client/api";
import type { OutreachDraft, VenueCard, VenueDraftBody, VenueEvent, VenueResult } from "@/app/_client/types";
import { ACTIVITY_LABEL, md } from "./labels";
import { CopyButton, ErrorLine, Spinner, Tag } from "./ui";

const STATUS_TEXT: Record<string, string> = { open: "募集中", unknown: "締切は公式で要確認", closed: "締切済み" };

/**
 * カード詳細の中の「出し先を探す」。ネタが先で、出し先（社外イベント）を探す。
 * 作業ログ → 出し先（最大3件）・ブログ案 → 選んだ出し先で本人への声かけ文の下書き（送らない）
 */
/** 出し先の注意点：2つまで見せて、残りは「ほかN件を見る」（合う理由より目立たないように） */
function VenueCautions({ items }: { items: string[] }) {
  const [all, setAll] = useState(false);
  return (
    <div>
      <ul className="cautions" aria-label="注意点">
        {(all ? items : items.slice(0, 2)).map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {items.length > 2 && (
        <button type="button" className="link small" aria-expanded={all} onClick={() => setAll((x) => !x)}>
          {all ? "たたむ" : `注意点をほか${items.length - 2}件見る`}
        </button>
      )}
    </div>
  );
}

export function VenueFinder({
  cardId,
  employeeName,
  onFind,
  onDraft,
  onDirtyChange,
}: {
  cardId: string;
  employeeName: string;
  onFind: (cardId: string, onEvent: (e: VenueEvent) => void) => Promise<void>;
  onDraft: (body: VenueDraftBody) => Promise<DraftResponse>;
  /** 下書きを書き換えたら「書きかけ」としてカード詳細に知らせる（外側クリック・Esc で閉じない） */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<VenueResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<VenueCard | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<OutreachDraft | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const dirty = !!draft && (subject !== draft.subject || message !== draft.message);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  async function find() {
    setRunning(true);
    setLog([]);
    setResult(null);
    setError(null);
    setPicked(null);
    setDraft(null);
    try {
      await onFind(cardId, (e) => {
        if (e.type === "tool_result") setLog((l) => [...l, e.summary]);
        if (e.type === "retry") setLog((l) => [...l, `提出を差し戻して探し直します：${e.message}`]);
        if (e.type === "error") setError(`${e.message}。もう一度「出し先を探す」を押してください。`);
        if (e.type === "venue_final") setResult(e.result);
      });
    } catch (err) {
      setError(`出し先を探せませんでした（${err instanceof Error ? err.message : "不明なエラー"}）。もう一度押してください。`);
    }
    setRunning(false);
  }

  async function makeDraft(v: VenueCard) {
    if (!result) return;
    setPicked(v);
    setDraft(null);
    setError(null);
    setDrafting(true);
    try {
      const j = await onDraft({ run_id: result.run_id, card_id: cardId, event_id: v.event_id, theme: v.theme, reason: v.reason, cautions: v.cautions });
      setDraft(j.draft);
      setSubject(j.draft.subject);
      setMessage(j.draft.message);
    } catch (err) {
      setError(`声かけ文を作れませんでした（${err instanceof Error ? err.message : "不明なエラー"}）。もう一度押してください。`);
    }
    setDrafting(false);
  }

  const outlineText = draft ? draft.lt_outline.map((s) => `${s.minutes}分　${s.heading}\n${s.points.map((p) => `・${p}`).join("\n")}`).join("\n") : "";

  return (
    <section className="block venue" aria-labelledby="cd-venue">
      <div className="row-between">
        <h3 id="cd-venue" className="h3">
          出し先
        </h3>
        <button type="button" className="btn btn-sm" disabled={running} onClick={find}>
          {running ? "探しています…" : result ? "もう一度探す" : "出し先を探す"}
        </button>
      </div>
      {!result && !running && <p className="meta">このネタを出せそうな社外イベント（応募を受け付けているもの）と、ブログ案を探します。</p>}
      {running && <Spinner label={log.length ? log[log.length - 1] : "Agentがイベントを探しています…"} />}
      <ErrorLine message={error} />

      {result && (
        <>
          <p className="small">{result.summary}</p>
          {result.venues.length > 0 && (
            <ol className="venue-list">
              {result.venues.map((v) => (
                <li key={v.event_id} className={`venue-item${picked?.event_id === v.event_id ? " is-picked" : ""}`}>
                  <div className="venue-head">
                    <span className="strong">{v.name}</span>
                    {v.confidence === "conditional" && <Tag tone="warn">条件付き</Tag>}
                  </div>
                  <p className="meta">
                    開催 {v.event_date ? md(v.event_date) : "未定"}・{v.format.join("／")}・
                    {v.cfp_deadline ? `締切 ${md(v.cfp_deadline)}` : STATUS_TEXT[v.cfp_status] ?? ""}
                    {v.location ? `・${v.location}` : ""}
                  </p>
                  <p className="strong small">{v.theme}</p>
                  <p className="small">{v.reason}</p>
                  {v.caveat && <p className="small warn-text">引っかかる点：{v.caveat}</p>}
                  {v.cautions.length > 0 && <VenueCautions items={v.cautions} />}
                  {v.evidence.length > 0 && (
                    <p className="meta">
                      根拠：{v.evidence.map((e) => `${ACTIVITY_LABEL[e.type] ?? e.type}「${e.title}」`).join("、")}
                    </p>
                  )}
                  <p className="meta">
                    情報は {md(v.checked_at)} 時点。
                    <a href={v.cfp_url ?? v.url} target="_blank" rel="noreferrer">
                      公式ページ
                    </a>
                    で最新の募集を確かめてください
                  </p>
                  <div className="btn-row">
                    <button type="button" className="btn btn-sm btn-primary" disabled={drafting} onClick={() => makeDraft(v)}>
                      {drafting && picked?.event_id === v.event_id ? "声かけ文を作っています…" : "このイベントで声かけ文を作る"}
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {result.no_fit && (
            <div className="venue-nofit">
              <p className="strong small">合う出し先は見つかりませんでした</p>
              <ul className="small">
                {result.no_fit.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <p className="meta">次に確かめること</p>
              <ul className="small">
                {result.no_fit.next_checks.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="venue-blog">
            <p className="strong small">ブログ案</p>
            {result.blog ? (
              <>
                <p className="small">{result.blog.title}</p>
                <p className="meta">{result.blog.why_easy_to_blog}</p>
                <ol className="small">
                  {result.blog.outline.map((o) => (
                    <li key={o}>{o}</li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="meta">{result.blog_note ?? "ブログ案はありません"}</p>
            )}
          </div>
        </>
      )}

      {picked && draft && (
        <div className="venue-draft">
          <p className="strong small">
            {employeeName}さんへの声かけ文（{picked.name}）
          </p>
          <p className="meta">自分の言葉に直して送ってください。この画面から送ることはできません。</p>
          <label className="field">
            <span className="field-label">件名</span>
            <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">本文</span>
            <textarea className="input draft-text" rows={12} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <div className="btn-row">
            <CopyButton text={`${subject}\n\n${message}`} label="声かけ文をコピー" primary />
            {dirty && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setSubject(draft.subject);
                  setMessage(draft.message);
                }}
              >
                下書きに戻す
              </button>
            )}
          </div>
          <p className="meta">構成案（合計 {draft.lt_outline.reduce((a, s) => a + s.minutes, 0)}分）</p>
          <ol className="small">
            {draft.lt_outline.map((s) => (
              <li key={s.heading}>
                {s.minutes}分　{s.heading}
              </li>
            ))}
          </ol>
          <CopyButton text={outlineText} label="構成案をコピー" />
          {draft.tips_for_pr.length > 0 && (
            <>
              <p className="meta">声をかける前に</p>
              <ul className="small">
                {draft.tips_for_pr.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
