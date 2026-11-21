"use client";

import { useCallback, useEffect, useState } from "react";
import type { Api } from "@/app/_client/api";
import type { EventDetail, EventListItem, SurveyEvent, TalkAnalysis } from "@/app/_client/types";
import { md } from "./labels";
import { ErrorLine, Spinner, Tag } from "./ui";

/** イベント：過去イベントの一覧 → 詳細（登壇ごとの数字と、アンケートの分析・書き戻し） */
export function EventsView({ api, onOpenCard, onCardsChanged }: { api: Api; onOpenCard: (cardId: string) => void; onCardsChanged: () => void }) {
  const [list, setList] = useState<EventListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const l = await api.events();
      setList(l);
      setOpenId((cur) => cur ?? l.find((e) => e.answers > 0)?.id ?? null);
    } finally {
      setLoaded(true);
    }
  }, [api]);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  return (
    <>
      <section aria-labelledby="ev-title" className="surface notebook">
        <div className="nb-top">
          <h2 id="ev-title" className="h2">
            イベント <span className="meta">{list.length}件</span>
          </h2>
        </div>
        <ul className="nb-list">
          {!loaded && <li className="meta pad">読み込んでいます…</li>}
          {list.map((e) => (
            <li key={e.id}>
              <button type="button" className={`nb-row${openId === e.id ? " is-candidate" : ""}`} aria-current={openId === e.id ? "true" : undefined} onClick={() => setOpenId(e.id)}>
                <span className="nb-who">
                  <span className="strong ev-name">{e.title}</span>
                  <span className="grow" />
                  {e.analyzed && <Tag tone="ok">分析済み</Tag>}
                  <span className="meta">{md(e.date)}</span>
                </span>
                <span className="nb-theme">
                  {e.speakers.map((s) => s.name).join("・")}　{e.answers ? `アンケート${e.answers}件` : "アンケートなし"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <div className="panel" aria-label="イベントの詳細">
        {openId ? <EventPanel key={openId} api={api} id={openId} onOpenCard={onOpenCard} onAnalyzed={() => (onCardsChanged(), void loadList())} /> : <p className="hint">イベントを選んでください。</p>}
      </div>
    </>
  );
}

function EventPanel({ api, id, onOpenCard, onAnalyzed }: { api: Api; id: string; onOpenCard: (cardId: string) => void; onAnalyzed: () => void }) {
  const [d, setD] = useState<EventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<Array<{ text: string; tone: "info" | "ok" | "warn" | "error" }>>([]);
  const [shown, setShown] = useState<string | null>(null);

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
        if (e.type === "start") setLog([{ text: `${e.talks}つの登壇・${e.answers}件の回答を読んでいます`, tone: "info" }]);
        if (e.type === "rejected") setLog((l) => [...l, { text: `まとめを差し戻して直してもらっています（${e.errors.length}件）`, tone: "warn" }]);
        if (e.type === "writeback") setLog((l) => [...l, { text: e.message, tone: "ok" }]);
        if (e.type === "error") setLog((l) => [...l, { text: e.message, tone: "error" }]);
      });
    } catch (err) {
      setLog((l) => [...l, { text: `分析できませんでした（${err instanceof Error ? err.message : "不明なエラー"}）。もう一度押してください。`, tone: "error" }]);
    }
    setRunning(false);
    // 書き戻したことは下の「カードに書き戻したこと」に出るので、ログには警告とエラーだけ残す
    setLog((l) => l.filter((x) => x.tone === "warn" || x.tone === "error"));
    await load();
    onAnalyzed();
  }

  if (error) return <ErrorLine message={error} />;
  if (!d) return <p className="meta pad">読み込んでいます…</p>;
  const answers = new Map(d.answers.map((a) => [a.id, a]));
  const analysis = d.analysis;
  const total = d.answers.length;

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
              <th scope="col">満足度の分布（1〜5）</th>
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
                  )}
                  <span className="meta">　{t.business_unit}</span>
                </td>
                <td className="num">{t.stats ? `${t.stats.count}件` : "—"}</td>
                <td className="num">{t.stats ? t.stats.average.toFixed(1) : "—"}</td>
                <td className="num meta">{t.stats ? t.stats.distribution.join("・") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={running || total === 0} onClick={analyze}>
            {running ? "分析しています…" : analysis ? "もう一度分析する" : "アンケートを分析する"}
          </button>
          <span className="meta">{total ? `回答${total}件。数字はコードで数えています` : "このイベントにはアンケートがありません"}</span>
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
            {running && <Spinner label="Agentがアンケートを読んでいます…" />}
          </div>
        )}
      </section>

      {analysis && (
        <section className="surface cands" aria-labelledby="ana-title">
          <div className="cands-head">
            <h2 id="ana-title" className="h2">
              アンケートの分析
            </h2>
            <p className="meta">根拠の回答を押すと、その回答が開きます</p>
          </div>
          {analysis.talks.map((t) => (
            <TalkBlock key={t.speaker_id} t={t} name={d.talks.find((x) => x.speaker_id === t.speaker_id)?.name ?? t.speaker_id} answers={answers} shown={shown} onShow={setShown} />
          ))}
          {analysis.writebacks.length > 0 && (
            <div className="nofit small">
              <h3 className="h4">カードに書き戻したこと</h3>
              <ul className="plain-list">
                {analysis.writebacks.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <p className="meta">提案（確認済みカードの反応・需要あり・テーマ案）は、カード詳細で採用／見送りできます。</p>
            </div>
          )}
        </section>
      )}
    </>
  );
}

function TalkBlock({
  t,
  name,
  answers,
  shown,
  onShow,
}: {
  t: TalkAnalysis;
  name: string;
  answers: Map<string, EventDetail["answers"][number]>;
  shown: string | null;
  onShow: (id: string | null) => void;
}) {
  const Refs = ({ ids }: { ids: string[] }) => (
    <span className="meta">
      {" "}
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && "、"}
          <button type="button" className="link" aria-expanded={shown === id} onClick={() => onShow(shown === id ? null : id)}>
            {id}
          </button>
        </span>
      ))}
    </span>
  );
  const ids = [...t.hits, ...t.stumbles, ...t.next_themes].flatMap((p) => p.response_ids);
  const open = shown && ids.includes(shown) ? answers.get(shown) : null;
  const Points = ({ title, items }: { title: string; items: Array<{ text: string; response_ids: string[]; overlaps_card_id?: string | null }> }) =>
    items.length ? (
      <div>
        <h4 className="h4">{title}</h4>
        <ul className="plain-list small">
          {items.map((p, i) => (
            <li key={i}>
              {p.text}
              {p.overlaps_card_id && <span className="caveat-inline">（別の社員の未発信カードと重なる → 需要ありを提案）</span>}
              <Refs ids={p.response_ids} />
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <article className="cand" aria-label={`${name}さんの登壇`}>
      <div className="cand-head">
        <span className="cand-name">{name}</span>
        <span className="meta">
          回答{t.stats.count}件・平均{t.stats.average.toFixed(1)}
        </span>
      </div>
      <p className="cand-theme">{t.summary}</p>
      <Points title="刺さった点" items={t.hits} />
      <Points title="多かった質問・つまずき" items={t.stumbles} />
      <Points title="次に聞きたいテーマ" items={t.next_themes} />
      {open && (
        <p className="answer small">
          <span className="meta">
            {open.id}・満足度{open.rating}
            {open.role ? `・${open.role}` : ""}
          </span>
          <br />
          {open.comment || "（感想は空欄）"}
          {open.want_next && (
            <>
              <br />
              <span className="meta">次に聞きたい：</span>
              {open.want_next}
            </>
          )}
        </p>
      )}
    </article>
  );
}
