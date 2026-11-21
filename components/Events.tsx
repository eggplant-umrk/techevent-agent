"use client";

import { useCallback, useEffect, useState } from "react";
import type { Api } from "@/app/_client/api";
import type { ColumnInfo, EventDetail, EventListItem, ImportResult, NegativeItem, SurveyEvent } from "@/app/_client/types";
import { md } from "./labels";
import { ErrorLine, Spinner, Tag } from "./ui";

const ROLE_LABEL: Record<ColumnInfo["role"], string> = {
  timestamp: "タイムスタンプ",
  talk: "どの登壇か",
  rating: "満足度",
  comment: "感想",
  want_next: "次に聞きたいテーマ",
  role: "職種",
  personal: "個人情報のため捨てた",
  unread: "読み取れない列（無視）",
};

/**
 * イベントの詳細（アンケートの取り込み・集計・分析・カードへの書き戻し）。
 * 一覧はアーカイブタブ（components/Archive.tsx）にあり、過去のイベントを開くとここが右に出る。
 */
export function EventPanel({ api, id, onOpenCard, onChanged }: { api: Api; id: string; onOpenCard: (cardId: string) => void; onChanged: () => void }) {
  const [d, setD] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<Array<{ text: string; tone: "info" | "ok" | "warn" | "error" }>>([]);

  const load = useCallback(async () => {
    try {
      setD(await api.eventDetail(id));
    } catch (err) {
      setError(`イベントを読み込めませんでした（${err instanceof Error ? err.message : "不明なエラー"}）。`);
    }
  }, [api, id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function analyze() {
    setRunning(true);
    setLog([]);
    try {
      await api.analyzeEvent(id, (e: SurveyEvent) => {
        if (e.type === "start") setLog([{ text: `${e.talks}つの登壇・${e.answers}件の回答（感想${e.sentences}文、空欄${e.excluded}件は除外）を読んでいます`, tone: "info" }]);
        if (e.type === "rejected") setLog((l) => [...l, { text: `読み取り結果を差し戻して直してもらっています（${e.errors.length}件）`, tone: "warn" }]);
        if (e.type === "writeback") setLog((l) => [...l, { text: e.message, tone: "ok" }]);
        if (e.type === "error") setLog((l) => [...l, { text: e.message, tone: "error" }]);
      });
    } catch (err) {
      setLog((l) => [...l, { text: `分析できませんでした（${err instanceof Error ? err.message : "不明なエラー"}）。もう一度押してください。`, tone: "error" }]);
    }
    setRunning(false);
    setLog((l) => l.filter((x) => x.tone === "warn" || x.tone === "error"));
    await load();
    onChanged();
  }

  if (error) return <ErrorLine message={error} />;
  if (!d) return <p className="meta pad">読み込んでいます…</p>;
  const a = d.analysis;
  const total = d.answers.length;
  const nameOf = (sp: string | null) => (sp === null ? "イベント全体" : d.talks.find((t) => t.speaker_id === sp)?.name ?? sp);

  return (
    <>
      <section className="surface pad-lg" aria-labelledby="evd-title">
        <p className="meta">
          {d.event.date}・{d.event.series}・{d.event.venue}・参加{d.event.attendees}人
        </p>
        <h2 id="evd-title" className="req-title">
          {d.event.title}
        </h2>
        <table className="talk-table">
          <thead>
            <tr>
              <th scope="col">登壇者</th>
              <th scope="col">回答</th>
              <th scope="col">満足度の平均</th>
              <th scope="col">分布（1〜5）</th>
            </tr>
          </thead>
          <tbody>
            {d.talks.map((t) => (
              <tr key={t.speaker_id}>
                <td>
                  {t.card_id ? (
                    <button type="button" className="link" onClick={() => onOpenCard(t.card_id!)}>
                      {t.name}
                    </button>
                  ) : (
                    t.name
                  )}{" "}
                  {t.stats?.highlight === "high" && <Tag tone="ok">満足度が高い</Tag>}
                  {t.stats?.highlight === "low" && <Tag tone="warn">満足度が低い</Tag>}
                </td>
                <td className="num">{t.stats ? `${t.stats.count}件` : "—"}</td>
                <td className="num">{t.stats ? t.stats.average.toFixed(1) : "—"}</td>
                <td className="num meta">{t.stats ? t.stats.distribution.join("・") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <SourceInfo d={d} />
        <ImportBox api={api} id={id} onImported={async () => (await load(), onChanged())} />
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={running || total === 0} onClick={analyze}>
            {running ? "分析しています…" : a ? "もう一度分析する" : "アンケートを分析する"}
          </button>
          <span className="meta">{total ? "件数・平均はコードで数えています" : "CSVを取り込むと分析できます"}</span>
        </div>
        {(log.length > 0 || running) && (
          <div className="steps-wrap">
            <ol className="log-lines">
              {log.map((l, i) => (
                <li key={i} className={`log-line log-${l.tone}`}>
                  {l.text}
                </li>
              ))}
            </ol>
            {running && <Spinner label="Agentが感想を読んでいます…" />}
          </div>
        )}
      </section>

      {a && (
        <>
          <section className="surface cands" aria-labelledby="neg-title">
            <div className="cands-head">
              <h2 id="neg-title" className="h2">
                ネガティブな声 <span className="meta">{a.negatives.operation.reduce((n, x) => n + x.count, 0) + a.negatives.content.reduce((n, x) => n + x.count, 0)}件</span>
              </h2>
              <p className="meta">原文のまま全部並べています（直しているのは個人情報の削除だけ）。カードには運営への不満と原文は入れません。</p>
            </div>
            <NegList title="運営（音響・時間・会場・配信など）" items={a.negatives.operation} nameOf={nameOf} />
            <NegList title="内容（難しい・速い・資料など）" items={a.negatives.content} nameOf={nameOf} />
          </section>

          <section className="surface cands" aria-labelledby="pos-title">
            <div className="cands-head">
              <h2 id="pos-title" className="h2">
                ポジティブな声
              </h2>
              <p className="meta">懇親会・受付・会場などは「イベント全体」として分け、登壇者のカードには入れません。</p>
            </div>
            <ul className="pos-list">
              {a.positives.map((p) => (
                <li key={`${p.speaker_id}-${p.theme}`}>
                  <p>
                    <span className="strong">{p.theme}</span>
                    <span className="meta">
                      　{p.count}件・{nameOf(p.speaker_id)}
                    </span>
                  </p>
                  {p.representatives.map((r) => (
                    <p key={r.id} className="quote small">
                      「{r.text}」
                    </p>
                  ))}
                </li>
              ))}
              {a.positives.length === 0 && <li className="meta">良い点の声はありませんでした。</li>}
            </ul>
          </section>

          <section className="surface cands" aria-labelledby="talk-title">
            <div className="cands-head">
              <h2 id="talk-title" className="h2">
                登壇ごとのまとめ
              </h2>
            </div>
            {a.talks.map((t) => (
              <article key={t.speaker_id} className="cand" aria-label={`${nameOf(t.speaker_id)}さんの登壇`}>
                <div className="cand-head">
                  <span className="cand-name">{nameOf(t.speaker_id)}</span>
                  <span className="meta">
                    回答{t.stats.count}件・平均{t.stats.average.toFixed(1)}
                  </span>
                </div>
                <p className="cand-theme">{t.summary}</p>
                {t.content_issue && (
                  <p className="caveat">
                    カードに残す事実：前回は{t.content_issue}を指摘する声が{t.content_complaints}件
                  </p>
                )}
                {t.next_themes.length > 0 && (
                  <div>
                    <h4 className="h4">次に聞きたいテーマ</h4>
                    <ul className="plain-list small">
                      {t.next_themes.map((n, i) => (
                        <li key={i}>
                          {n.text}
                          <span className="meta">　{n.response_ids.length}件</span>
                          {n.overlaps_card_id && <span className="caveat-inline">（別の社員の未発信カードと重なる → 需要ありを提案）</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
            {a.writebacks.length > 0 && (
              <div className="nofit small">
                <h3 className="h4">カードに書き戻したこと</h3>
                <ul className="plain-list">
                  {a.writebacks.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                <p className="meta">提案（確認済みカードの反応・需要あり・テーマ案）は、カード詳細で採用／見送りできます。</p>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function NegList({ title, items, nameOf }: { title: string; items: NegativeItem[]; nameOf: (sp: string | null) => string }) {
  const n = items.reduce((x, i) => x + i.count, 0);
  return (
    <div className="cand">
      <h3 className="h4">
        {title}　<span className="meta">{n}件</span>
      </h3>
      {items.length === 0 ? (
        <p className="meta">ありませんでした。</p>
      ) : (
        <ul className="neg-list">
          {items.map((i) => (
            <li key={i.sentence_ids[0]}>
              <span>{i.text}</span>
              <span className="meta">
                {i.count > 1 ? `　${i.count}件` : "　1件"}・{i.speaker_ids.map(nameOf).join("・")}
              </span>
              {i.attack && (
                <>
                  {" "}
                  <Tag tone="warn">人を攻撃する言葉（カードには残しません）</Tag>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SourceInfo({ d }: { d: EventDetail }) {
  if (!d.source) return <p className="meta">アンケートの回答はまだありません。</p>;
  const s = d.source;
  return (
    <details className="req-message">
      <summary>
        {s.source === "sample" ? "架空データのCSV" : `取り込んだCSV（${s.imported_at.slice(0, 16).replace("T", " ")}）`}：{s.rows}行・列{s.columns.length}つ
        {s.columns.some((c) => c.role === "personal") && "・個人情報の列は捨てました"}
        {s.unmatched_rows.length > 0 && `・どの登壇か分からない回答${s.unmatched_rows.length}件`}
      </summary>
      <table className="talk-table">
        <thead>
          <tr>
            <th scope="col">質問文（CSVの1行目）</th>
            <th scope="col">読み取った意味</th>
          </tr>
        </thead>
        <tbody>
          {s.columns.map((c) => (
            <tr key={c.index}>
              <td>{c.header}</td>
              <td className={c.role === "personal" || c.role === "unread" ? "meta" : undefined}>
                {ROLE_LABEL[c.role]}
                {c.by === "agent" && "（Agentが判断）"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function ImportBox({ api, id, onImported }: { api: Api; id: string; onImported: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(csv: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.importSurvey(id, csv);
      setResult(r);
      if (r.saved) onImported();
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "取り込めませんでした"}。`);
    }
    setBusy(false);
  }

  return (
    <details className="req-message">
      <summary>Googleフォームの回答（CSV）を取り込む</summary>
      <div className="import-box">
        <p className="meta">スプレッドシートの「ファイル → ダウンロード → CSV」で書き出したファイルを選ぶか、中身を貼ってください。メール・名前の列は取り込み時に捨てます。</p>
        <label className="field">
          <span className="field-label">CSVファイル</span>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) await run(await f.text());
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">または、CSVの中身を貼る</span>
          <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="タイムスタンプ,満足度を教えてください,…" />
        </label>
        <div className="btn-row">
          <button type="button" className="btn btn-sm" disabled={busy || !text.trim()} onClick={() => run(text)}>
            {busy ? "取り込んでいます…" : "貼った内容を取り込む"}
          </button>
        </div>
        <ErrorLine message={error} />
        {result && (
          <p className="ok-line small" role="status">
            {result.saved ? "取り込みました" : "読み取りました（モックのため保存していません）"}：回答{result.answers}件（{result.rows}行）
            {result.columns.filter((c) => c.role === "personal").length > 0 && `・個人情報の列${result.columns.filter((c) => c.role === "personal").length}つを捨てました`}
            {result.columns.filter((c) => c.role === "unread").length > 0 && `・読み取れない列${result.columns.filter((c) => c.role === "unread").length}つは無視しました`}
            {result.unmatched_rows.length > 0 && `・どの登壇か分からない回答${result.unmatched_rows.length}件`}
          </p>
        )}
      </div>
    </details>
  );
}
