"use client";
// 人の画面の「直近のブログ」。新しい順に3件まで（タイトル・日付・要約の1〜2行）。もっとあれば「すべて見る」で開く。
// 本物の URL の記事は新しいタブで開き、架空の記事はアプリの中の記事ページ（/blog/{id}）を開く。データは lib/blogView.ts
import { useState } from "react";
import type { BlogItem } from "@/lib/blogView";

const SHOW = 3;
const md = (d: string) => d.slice(5).replace("-", "/");

export function RecentBlogs({ blogs }: { blogs: BlogItem[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? blogs : blogs.slice(0, SHOW);
  return (
    <section className="surface pad-lg" aria-labelledby="pd-blogs">
      <h3 id="pd-blogs" className="h3">
        直近のブログ
      </h3>
      {blogs.length === 0 ? (
        <p className="meta">まだブログはありません。</p>
      ) : (
        <ul className="plain-list small" style={{ gap: 10 }}>
          {shown.map((b) => (
            <li key={b.id}>
              <span className="meta">{md(b.date)}</span>
              {"　"}
              {b.external ? (
                <a href={b.href} target="_blank" rel="noreferrer">
                  {b.title}
                </a>
              ) : (
                <a href={b.href}>{b.title}</a>
              )}
              {b.fictional && <span className="meta">（架空の記事）</span>}
              {b.summary && (
                <p
                  className="meta"
                  style={{ margin: "2px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                >
                  {b.summary}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {blogs.length > SHOW && (
        <button type="button" className="link" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "3件だけ表示" : `すべて見る（${blogs.length}件）`}
        </button>
      )}
    </section>
  );
}
