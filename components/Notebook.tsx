"use client";

import { useMemo, useState } from "react";
import type { BlogIdea, NotebookCard } from "@/app/_client/types";
import { md } from "./labels";
import { CardMarks, ErrorLine, Spinner } from "./ui";

export type NbLogLine = { text: string; tone: "info" | "ok" | "warn" | "error" };
type Filter = "unpublished" | "noTalk" | "reviewed";

export function Notebook({
  cards,
  units,
  loaded,
  candidateIds,
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
  /** Cards proposed for the current request: highlighted in the list. */
  candidateIds: Set<string>;
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
            ネタ帳 <span className="meta">{anyFilter ? `${visible.length} / ${cards.length}枚` : `${cards.length}枚`}</span>
          </h2>
          <button type="button" className="btn btn-sm btn-ghost link-btn" onClick={onBlog} disabled={blogBusy}>
            {blogBusy ? "考えています…" : "ブログのネタを出す"}
          </button>
        </div>
        <input type="search" className="input" aria-label="カードを探す" placeholder="人・技術・テーマで検索" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="filter-row">
          <div role="group" aria-label="絞り込み" className="chips">
            {chips.map(([f, label, n]) => (
              <button key={f} type="button" className="chip" aria-pressed={filters.has(f)} onClick={() => toggle(f)}>
                {label} {n}
              </button>
            ))}
          </div>
          <select className="input input-sm" aria-label="事業部" value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">すべての事業部</option>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(log.length > 0 || updating) && (
        <div className="nb-section" aria-live="polite">
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

      {(blog || blogError) && (
        <div className="nb-section" aria-label="ブログのネタ">
          <ErrorLine message={blogError} />
          {blog && (
            <>
              <div className="row-between">
                <h3 className="h4">ブログにしやすい未発信のカード</h3>
                <button type="button" className="link" onClick={onCloseBlog}>
                  閉じる
                </button>
              </div>
              {blog.length === 0 && <p className="meta">未発信のカードがありません。</p>}
              <ol className="blog-list small">
                {blog.map((b) => (
                  <li key={b.card_id}>
                    <button type="button" className="link" onClick={() => onOpen(b.card_id)}>
                      {b.title}
                    </button>
                    <span className="meta">　{cards.find((x) => x.card_id === b.card_id)?.employee?.name}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      <ul className="nb-list">
        {!loaded && <li className="meta pad">読み込んでいます…</li>}
        {loaded && cards.length === 0 && <li className="empty meta">まだカードがありません。「ネタ帳を更新」を押してください。</li>}
        {loaded && cards.length > 0 && visible.length === 0 && (
          <li className="empty">
            <span className="meta">条件に合うカードがありません。</span>
            <button type="button" className="link" onClick={clear}>
              絞り込みを外す
            </button>
          </li>
        )}
        {visible.map((c) => (
          <li key={c.card_id}>
            <button
              type="button"
              className={`nb-row${candidateIds.has(c.card_id) ? " is-candidate" : ""}`}
              onClick={() => onOpen(c.card_id)}
              aria-label={candidateIds.has(c.card_id) ? `${c.employee?.name}（今回の候補）` : undefined}
            >
              <span className="nb-who">
                <span className="strong">{c.employee?.name ?? c.employee_id}</span>
                <span className="meta">
                  {c.employee?.business_unit}・登壇{c.employee?.past_talk_count ?? 0}回
                </span>
                <span className="grow" />
                <span className="tags nb-marks">
                  <CardMarks card={c} />
                </span>
                <span className="meta">{md(c.latest_activity_date)}</span>
              </span>
              <span className="nb-theme" title={c.themes[0]}>
                {c.themes[0]}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
