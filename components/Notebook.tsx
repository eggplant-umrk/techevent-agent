"use client";

import { useMemo, useState } from "react";
import type { BlogIdea, NotebookCard } from "@/app/_client/types";
import { md } from "./labels";
import { CardTags, ErrorLine, Spinner, Tag } from "./ui";

export type NbLogLine = { text: string; tone: "info" | "ok" | "warn" | "error" };
type Filter = "unpublished" | "noTalk" | "reviewed";

/** ISO time → "11/21 14:27" in Japan time. */
const stamp = (iso: string) =>
  new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

export function Notebook({
  cards,
  units,
  loaded,
  candidateRanks,
  log,
  updating,
  blog,
  blogBusy,
  blogError,
  onBlog,
  onCloseBlog,
  onOpen,
}: {
  cards: NotebookCard[];
  units: string[];
  loaded: boolean;
  /** card_id → rank of the current proposal, to mark candidates in the list. */
  candidateRanks: Map<string, number>;
  log: NbLogLine[];
  updating: boolean;
  blog: BlogIdea[] | null;
  blogBusy: boolean;
  blogError: string | null;
  onBlog: () => void;
  onCloseBlog: () => void;
  onOpen: (cardId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [unit, setUnit] = useState("");

  const counts = useMemo(
    () => ({
      unpublished: cards.filter((c) => c.publication_status === "unpublished").length,
      noTalk: cards.filter((c) => (c.employee?.past_talk_count ?? 0) === 0).length,
      reviewed: cards.filter((c) => c.reviewed).length,
    }),
    [cards],
  );
  const lastUpdated = cards.reduce((m, c) => (c.updated_at > m ? c.updated_at : m), "");

  const needle = q.trim().toLowerCase();
  const visible = cards.filter((c) => {
    if (filters.has("unpublished") && c.publication_status !== "unpublished") return false;
    if (filters.has("noTalk") && (c.employee?.past_talk_count ?? 0) !== 0) return false;
    if (filters.has("reviewed") && !c.reviewed) return false;
    if (unit && c.employee?.business_unit !== unit) return false;
    if (!needle) return true;
    const hay = [c.employee?.name, c.employee?.business_unit, c.employee?.role, c.summary, ...c.themes].join(" ").toLowerCase();
    return hay.includes(needle);
  });

  const toggle = (f: Filter) =>
    setFilters((s) => {
      const n = new Set(s);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });
  const clear = () => {
    setFilters(new Set());
    setUnit("");
    setQ("");
  };
  const anyFilter = filters.size > 0 || unit !== "" || needle !== "";

  const chips: Array<[Filter, string, number]> = [
    ["unpublished", "未発信", counts.unpublished],
    ["noTalk", "登壇経験なし", counts.noTalk],
    ["reviewed", "確認済み", counts.reviewed],
  ];

  return (
    <section aria-labelledby="nb-title" className="surface notebook">
      <div className="nb-top">
        <div className="row-between">
          <h2 id="nb-title" className="h2">
            ネタ帳
          </h2>
          <span className="meta">
            カード {cards.length}枚{lastUpdated && `・最終更新 ${stamp(lastUpdated)}`}
          </span>
        </div>
        <label className="field">
          <span className="field-label">カードを探す</span>
          <input type="search" className="input" placeholder="人・技術・テーマで検索" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div role="group" aria-label="絞り込み" className="chips">
            <button type="button" className="chip" aria-pressed={!anyFilter} onClick={clear}>
              すべて {cards.length}
            </button>
            {chips.map(([f, label, n]) => (
              <button key={f} type="button" className="chip" aria-pressed={filters.has(f)} onClick={() => toggle(f)}>
                {label} {n}
              </button>
            ))}
        </div>
        <div className="filter-row">
          <label className="unit-select">
            <span className="visually-hidden">事業部</span>
            <select className="input input-sm" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">すべての事業部</option>
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <span className="meta grow">{anyFilter ? `${visible.length}枚を表示` : "確認済み・新しい順"}</span>
          <button type="button" className="btn btn-sm" onClick={onBlog} disabled={blogBusy}>
            {blogBusy ? "ブログのネタを考えています…" : "ブログのネタを出す"}
          </button>
        </div>
      </div>

      {(log.length > 0 || updating) && (
        <div className="nb-log" aria-live="polite">
          <h3 className="h3">ネタ帳の更新</h3>
          <ol className="log-lines">
            {log.map((l, i) => (
              <li key={i} className={`log-line log-${l.tone}`}>
                {l.text}
              </li>
            ))}
          </ol>
          {updating && <Spinner label="活動を読んでいます…" />}
        </div>
      )}

      <ErrorLine message={blogError} />
      {blog && (
        <div className="blog" aria-label="ブログのネタ">
          <div className="row-between">
            <h3 className="h3">ブログにしやすい未発信のカード</h3>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onCloseBlog}>
              閉じる
            </button>
          </div>
          {blog.length === 0 && <p className="meta">未発信のカードがありません。</p>}
          <ol className="blog-list">
            {blog.map((b) => {
              const c = cards.find((x) => x.card_id === b.card_id);
              return (
                <li key={b.card_id}>
                  <p className="strong">{b.title}</p>
                  <p className="small">
                    {c?.employee?.name}・{b.why_easy_to_blog}
                  </p>
                  <button type="button" className="link" onClick={() => onOpen(b.card_id)}>
                    カードを見る
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <ul className="nb-list">
        {!loaded && <li className="meta pad">読み込んでいます…</li>}
        {loaded && cards.length === 0 && (
          <li className="empty">
            <p className="strong">まだカードがありません</p>
            <p className="small">右上の「ネタ帳を更新」を押すと、Agentが社内の取り組みを読んでカードを作ります。</p>
          </li>
        )}
        {loaded && cards.length > 0 && visible.length === 0 && (
          <li className="empty">
            <p className="strong">条件に合うカードがありません</p>
            <button type="button" className="btn btn-sm" onClick={clear}>
              絞り込みを外す
            </button>
          </li>
        )}
        {visible.map((c) => {
          const rank = candidateRanks.get(c.card_id);
          return (
            <li key={c.card_id}>
              <button type="button" className={`nb-row${rank ? " is-candidate" : ""}`} onClick={() => onOpen(c.card_id)}>
                <span className="nb-who">
                  <span className="strong">{c.employee?.name ?? c.employee_id}</span>
                  <span className="meta">{c.employee?.business_unit}</span>
                  <span className="grow" />
                  <span className="meta">{md(c.latest_activity_date)}</span>
                </span>
                <span className="nb-theme">{c.themes[0]}</span>
                <span className="tags">
                  {rank && <Tag tone="accent">候補 {rank}位</Tag>}
                  <CardTags card={c} compact />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
