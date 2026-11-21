"use client";

import { useCallback, useEffect, useState } from "react";
import type { Api } from "@/app/_client/api";
import type { ColumnInfo, EventDetail, ImportResult, SurveyEvent } from "@/app/_client/types";
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
 * イベントの詳細（アンケートの取り込み・集計・分析・カードへの書き戻し）。窓口のイベント単位の集計（overview）だけを使う。
 * 登壇者は「誰が何を話したか」だけ。登壇者ごとの点数・不満・良い点、不満がどの登壇への声かは出さない。
 * 一覧はアーカイブタブ（components/Archive.tsx）にあり、過去のイベントを開くとここが右に出る。
 */
export function EventPanel({ api, id, onChanged }: { api: Api; id: string; onChanged: () => void }) {
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
  const o = d.overview;
  const a = o.analysis;
  const st = o.stats;
  const r = st.overall_rating;
  const total = st.answers;
  const negCount = a ? [...a.negatives.operation, ...a.negatives.content].reduce((n, x) => n + x.count, 0) : 0;

  return (
    <>
      <section className="surface pad-lg" aria-labelledby="evd-title">
        <p className="meta">
          {d.event.date}・{d.event.series}・{d.event.venue}
        </p>
        <h2 id="evd-title" className="req-title">
          {d.event.title}
        </h2>
        {/* イベントの告知ページ：connpass_url があればそのページ、なければアプリの中の架空のページ（/events/{id}） */}
        <p className="btn-row">
          <a
            className="btn btn-sm"
            href={d.event.connpass_url?.trim() || `/events/${encodeURIComponent(d.event.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            イベントページを開く
          </a>
          {!d.event.connpass_url?.trim() && <span className="meta">（架空のイベントのため、アプリの中の架空のページを開きます）</span>}
        </p>
        <h3 className="h4">登壇</h3>
        <ul className="plain-list small">
          {d.speakers.map((sp) => (
            <li key={sp.name}>
              <span className="strong">{sp.name}</span>
              <span className="meta">（{sp.business_unit}）</span>
              {sp.title ? `「${sp.title}」` : <span className="meta">　タイトルは記録にありません</span>}
            </li>
          ))}
        </ul>
        <dl className="person-facts">
          <dt>回答</dt>
          <dd>
            {total}件<span className="meta">（感想あり{st.with_comment}件・次に聞きたいテーマあり{st.with_want_next}件）</span>
          </dd>
          <dt>全体の満足度</dt>
          <dd>
            {r ? (
              <>
                平均{r.average.toFixed(1)}
                <span className="meta">（{r.rated}件・1〜5の分布 {r.distribution.join("・")}）</span>
              </>
            ) : (
              <span className="meta">満足度の列がありません</span>
            )}
          </dd>
        </dl>
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
          {a.sample && (
            <p className="small caveat" role="note">
              架空のアンケートの結果です（保存済みの分析結果を表示しています。CSV を取り込んで分析し直すと、ここが置き換わります）。
            </p>
          )}
          <section className="surface cands" aria-labelledby="pos-title">
            <div className="cands-head">
              <h2 id="pos-title" className="h2">
                良かった点
              </h2>
              <p className="meta">感想をテーマごとにまとめています（イベント全体の声と、登壇の中身への声）。</p>
            </div>
            <ul className="pos-list">
              {a.positives.map((p) => (
                <li key={`${p.scope}-${p.theme}`}>
                  <p>
                    <span className="strong">{p.theme}</span>
                    <span className="meta">
                      　{p.count}件・{p.scope === "event" ? "イベント全体" : "登壇の中身"}
                    </span>
                  </p>
                  {p.representatives.map((t, i) => (
                    <p key={i} className="quote small">
                      「{t}」
                    </p>
                  ))}
                </li>
              ))}
              {a.positives.length === 0 && <li className="meta">良い点の声はありませんでした。</li>}
            </ul>
          </section>

          <section className="surface cands" aria-labelledby="neg-title">
            <div className="cands-head">
              <h2 id="neg-title" className="h2">
                改善点 <span className="meta">{negCount}件</span>
              </h2>
              <p className="meta">原文のまま並べています（直しているのは個人情報の削除だけ）。</p>
            </div>
            <NegList title="運営・会場・設備" items={a.negatives.operation} />
            <NegList title="内容" items={a.negatives.content} />
          </section>

          <section className="surface cands" aria-labelledby="next-title">
            <div className="cands-head">
              <h2 id="next-title" className="h2">
                次に聞きたいテーマ
              </h2>
            </div>
            <ul className="plain-list small pad-list">
              {a.next_themes.map((n, i) => (
                <li key={i}>
                  {n.text}
                  <span className="meta">　{n.count}件</span>
                  {n.demand && <span className="caveat-inline">（社内の未発信のネタと重なる → 需要ありを提案）</span>}
                </li>
              ))}
              {a.next_themes.length === 0 && <li className="meta">ありませんでした。</li>}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

type OverviewNegative = EventDetail["overview"]["analysis"] extends infer A ? (A extends { negatives: { operation: Array<infer N> } } ? N : never) : never;

function NegList({ title, items }: { title: string; items: OverviewNegative[] }) {
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
          {items.map((i, k) => (
            <li key={k}>
              <span>{i.text}</span>
              <span className="meta">{i.count > 1 ? `　${i.count}件` : "　1件"}</span>
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
