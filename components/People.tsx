"use client";

import { useMemo, useState } from "react";
import type { BlogIdea, NotebookCard, PersonRow } from "@/app/_client/types";
import { ErrorLine, Spinner, Tag } from "./ui";

export type NbLogLine = { text: string; tone: "info" | "ok" | "warn" | "error" };
type Filter = "unpublished" | "noTalk";

/**
 * ネタ帳タブの左：人の一覧（社員全員。カードのない人も出す）。
 * 1行：名前・所属／得意分野（3つまで）／未発信のネタの数。予定はネタ帳タブには出さない。
 * 印は「今は控えたい」「情報を確認済み」だけ。未発信のネタが 0 のときは数を出さない。
 */
export function People({
  people,
  units,
  loaded,
  openId,
  onOpen,
  cards,
  pending,
  updating,
  log,
  onUpdate,
  blog,
  blogBusy,
  blogError,
  onBlog,
  onCloseBlog,
  onOpenCard,
  voiceCount,
  voicesOpen,
  onVoices,
  unassignedCount,
  unassignedOpen,
  onUnassigned,
}: {
  people: PersonRow[];
  units: string[];
  loaded: boolean;
  openId: string | null;
  onOpen: (id: string) => void;
  cards: NotebookCard[];
  pending: number;
  updating: boolean;
  log: NbLogLine[];
  onUpdate: () => void;
  blog: BlogIdea[] | null;
  blogBusy: boolean;
  blogError: string | null;
  onBlog: () => void;
  onCloseBlog: () => void;
  onOpenCard: (cardId: string) => void;
  /** アンケートの声の件数（右に一覧を出すボタン） */
  voiceCount: number;
  voicesOpen: boolean;
  onVoices: () => void;
  /** 担当者未定のネタの件数（右に一覧を出すボタン） */
  unassignedCount: number;
  unassignedOpen: boolean;
  onUnassigned: () => void;
}) {
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Set<Filter>>(new Set());
  const [unit, setUnit] = useState("");

  const counts = useMemo(
    () => ({ unpublished: people.filter((p) => p.unpublished_cards > 0).length, noTalk: people.filter((p) => p.talk_tag === "初登壇").length }),
    [people],
  );
  const needle = q.trim().toLowerCase();
  const visible = people.filter((p) => {
    if (filters.has("unpublished") && p.unpublished_cards === 0) return false;
    if (filters.has("noTalk") && p.talk_tag !== "初登壇") return false;
    if (unit && p.business_unit !== unit) return false;
    if (!needle) return true;
    return [p.name, p.business_unit, ...p.expertise_tags].join(" ").toLowerCase().includes(needle);
  });
  const toggle = (f: Filter) =>
    setFilters((s) => {
      const n = new Set(s);
      if (n.has(f)) n.delete(f);
      else n.add(f);
      return n;
    });
  const anyFilter = filters.size > 0 || unit !== "" || needle !== "";

  return (
    <section aria-labelledby="people-title" className="surface notebook">
      <div className="nb-top">
        <div className="row-between">
          <h2 id="people-title" className="h2">
            人 <span className="meta">{anyFilter ? `${visible.length} / ${people.length}人` : `${people.length}人`}</span>
          </h2>
          <div className="btn-row">
            <button type="button" className="btn btn-sm btn-ghost link-btn" onClick={onBlog} disabled={blogBusy}>
              {blogBusy ? "考えています…" : "ブログのネタを出す"}
            </button>
            <button type="button" className="btn btn-sm" onClick={onUpdate} disabled={updating}>
              {updating ? "更新しています…" : `ネタ帳を更新${pending ? `（${pending}人分）` : ""}`}
            </button>
          </div>
        </div>
        <div className="chips">
          <button type="button" className="chip voices-chip" aria-pressed={voicesOpen} onClick={onVoices} title="イベント後のアンケートで、参加者が今後聞いてみたい話">
            アンケートの声 {voiceCount}件
          </button>
          <button type="button" className="chip voices-chip" aria-pressed={unassignedOpen} onClick={onUnassigned} title="リリースノートから作った、担当者が決まっていないネタ">
            担当者未定のネタ {unassignedCount}件
          </button>
        </div>
        <input type="search" className="input" aria-label="人を探す" placeholder="名前・所属・得意分野で検索" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="filter-row">
          <div role="group" aria-label="絞り込み" className="chips">
            <button type="button" className="chip" aria-pressed={filters.has("unpublished")} onClick={() => toggle("unpublished")}>
              未発信のネタあり {counts.unpublished}
            </button>
            <button type="button" className="chip" aria-pressed={filters.has("noTalk")} onClick={() => toggle("noTalk")}>
              初登壇 {counts.noTalk}
            </button>
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
                <h3 className="h4">ブログにしやすい未発信のネタ</h3>
                <button type="button" className="link" onClick={onCloseBlog}>
                  閉じる
                </button>
              </div>
              {blog.length === 0 && <p className="meta">未発信のネタがありません。</p>}
              <ol className="blog-list small">
                {blog.map((b) => (
                  <li key={b.card_id}>
                    <button type="button" className="link" onClick={() => onOpenCard(b.card_id)}>
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
        {loaded && people.length > 0 && visible.length === 0 && (
          <li className="empty">
            <span className="meta">条件に合う人がいません。</span>
            <button
              type="button"
              className="link"
              onClick={() => {
                setFilters(new Set());
                setUnit("");
                setQ("");
              }}
            >
              絞り込みを外す
            </button>
          </li>
        )}
        {visible.map((p) => (
          <li key={p.id}>
            <button type="button" className="nb-row" aria-current={openId === p.id ? "true" : undefined} onClick={() => onOpen(p.id)}>
              <span className="nb-who">
                <span className="strong">{p.name}</span>
                <span className="meta">{p.business_unit}</span>
                <span className="grow" />
                <span className="tags nb-marks">
                  {p.is_demo && <Tag tone="accent">本人（デモ）</Tag>}
                  {p.speaking_intent === "hold" && <Tag tone="warn">今は控えたい</Tag>}
                  {p.reviewed && <Tag tone="ok">情報を確認済み</Tag>}
                </span>
              </span>
              <span className="person-line">
                <span className="nb-theme">{p.expertise_tags.slice(0, 3).join("・")}</span>
                {p.unpublished_cards > 0 && (
                  <span className="meta person-num" title="未発信のネタ">
                    未発信 {p.unpublished_cards}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
