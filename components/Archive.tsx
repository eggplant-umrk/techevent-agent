"use client";

import type { Api } from "@/app/_client/api";
import type { ArchiveDetail, ArchiveKind, ArchiveRow } from "@/app/_client/types";
import { EventPanel } from "./Events";
import { md, REASON_LABEL, RESULT_LABEL } from "./labels";
import { Spinner, Tag } from "./ui";

const KIND_LABEL: Record<ArchiveKind, string> = { inbox: "届いた依頼", request: "サンプルの依頼", event: "イベント" };

/** アーカイブタブの左：開催日が過ぎた依頼とイベント（新しい順） */
export function ArchiveList({
  rows,
  loaded,
  openKey,
  onOpen,
}: {
  rows: ArchiveRow[];
  loaded: boolean;
  openKey: string | null;
  onOpen: (kind: ArchiveKind, id: string) => void;
}) {
  return (
    <section aria-labelledby="archive-title" className="surface notebook">
      <div className="nb-top">
        <h2 id="archive-title" className="h2">
          過去の依頼とイベント <span className="meta">{rows.length}件</span>
        </h2>
        <p className="meta">開催日が過ぎたものは受信箱からここに移ります。</p>
      </div>
      <ul className="nb-list">
        {!loaded && <li className="meta pad">読み込んでいます…</li>}
        {loaded && rows.length === 0 && <li className="meta pad">まだありません。</li>}
        {rows.map((r) => (
          <li key={`${r.kind}:${r.id}`}>
            <button type="button" className="nb-row" aria-current={openKey === `${r.kind}:${r.id}` ? "true" : undefined} onClick={() => onOpen(r.kind, r.id)}>
              <span className="nb-who">
                <span className="meta archive-date">{r.date}</span>
                <span className="grow" />
                <span className="tags nb-marks">
                  {r.kind !== "event" && <Tag>{KIND_LABEL[r.kind]}</Tag>}
                  {r.analyzed && <Tag tone="ok">分析済み</Tag>}
                </span>
              </span>
              <span className="nb-theme strong-theme">{r.title}</span>
              <span className="meta">
                {r.speakers.length ? `登壇：${r.speakers.join("・")}` : "登壇者なし"}
                {r.kind === "event" && `　${r.answers ? `アンケート${r.answers}件` : "アンケートなし"}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * アーカイブタブの右。
 * - 過去のイベント：イベント後の画面（日付・登壇者・アンケートの取り込み・分析・カードへの書き戻し）をそのまま出す
 * - 過去の依頼：日付・登壇者・依頼の結果
 */
export function ArchiveView({
  detail,
  api,
  onChanged,
  loading = false,
}: {
  detail: ArchiveDetail | null;
  /** 選んだ依頼・イベントを読み込んでいる間 */
  loading?: boolean;
  api: Api;
  /** アンケートを取り込んだ・分析した（カードと一覧を読み直す） */
  onChanged: () => void;
}) {
  if (!detail && loading)
    return (
      <div className="panel" aria-busy="true">
        <section className="surface pad-lg">
          <Spinner label="読み込んでいます…" />
        </section>
      </div>
    );
  if (!detail)
    return (
      <div className="panel">
        <section className="surface pad-lg">
          <p className="meta">左から過去の依頼かイベントを選んでください。</p>
        </section>
      </div>
    );
  if (detail.kind === "event")
    return (
      <div className="panel" aria-label="過去のイベントの詳細">
        <EventPanel key={detail.id} api={api} id={detail.id} onChanged={onChanged} />
      </div>
    );
  return (
    <div className="panel" aria-label="過去の依頼の詳細">
      <section className="surface pad-lg" aria-labelledby="ar-title">
        <p className="meta">
          {KIND_LABEL[detail.kind]}・{detail.date}
          {detail.place ? `・${detail.place}` : ""}
          {detail.series ? `・${detail.series}` : ""}
        </p>
        <h2 id="ar-title" className="h2">
          {detail.title}
        </h2>
        <dl className="person-facts">
          <dt>日付</dt>
          <dd>{detail.date}</dd>
          <dt>登壇者</dt>
          <dd>{detail.speakers.length ? detail.speakers.join("・") : "なし"}</dd>
          {detail.candidates.length > 0 && (
            <>
              <dt>候補に出した人</dt>
              <dd>{detail.candidates.join("・")}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="surface pad-lg" aria-labelledby="ar-result">
        <h3 id="ar-result" className="h3">
          依頼の結果
        </h3>
        {detail.outcomes.length === 0 ? (
          <p className="meta">記録された結果はありません。</p>
        ) : (
          <ul className="plain-list small">
            {detail.outcomes.map((o, i) => (
              <li key={i}>
                <span className="meta">{md(o.date)}</span>　{o.name}：{RESULT_LABEL[o.result as keyof typeof RESULT_LABEL] ?? o.result}
                {o.reason ? `（${REASON_LABEL[o.reason as keyof typeof REASON_LABEL] ?? o.reason}）` : ""}
              </li>
            ))}
          </ul>
        )}
        {detail.text && (
          <details className="small">
            <summary>依頼の本文</summary>
            <p className="pre">{detail.text}</p>
          </details>
        )}
      </section>

    </div>
  );
}
