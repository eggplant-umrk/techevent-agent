// 人を選ぶ材料を足す：社内技術ブログ（架空）と、Slack の一部（練習用ワークスペースの指定チャンネル）。
// どちらも活動の1種類として activities() に入り、ネタ帳の更新（差分読み・コードでの絞り込み・金額の上限）にそのまま乗る。
//
// - ブログ（data/sources/blog_posts.json）：既存の published の「メンバーのブログ」と同じ記事に、本文の要約（架空）を付けたもの。
//   活動の種類は blog（id は blg001 など）。同じ記事の published_id を持ち、根拠に入れたカードは「ブログ済み」になる（lib/cards.ts）
// - Slack（data/sources/slack_posts.json）：scripts/slack/sources.ts が指定チャンネルから読んで保存したもの。
//   活動の種類は slack（id は slk001 など）。保存するのは本文の先頭400字・permalink・日時と、対応表で決めた社員 id だけ
// 架空の会社のデータのときだけ入れる（DATA_SOURCE=github では入れない）。評価は MORE_SOURCES=off で入れない。
import fs from "node:fs";
import path from "node:path";
import type { Activity } from "./data";
import { dataSource } from "./dataSource";

export interface BlogPost {
  id: string;
  /** 同じ記事の published（発信済みの記録）の id */
  published_id: string;
  author_id: string;
  date: string;
  title: string;
  url: string;
  /** 本文の要約（3〜5文、架空） */
  summary: string;
}

export interface SlackPost {
  id: string;
  employee_id: string;
  /** 投稿の日時（ISO） */
  posted_at: string;
  permalink: string;
  /** 本文の先頭400字 */
  text: string;
}

const SRC = () => path.join(process.cwd(), "data", "sources");
export const SLACK_POSTS_FILE = () => process.env.SLACK_POSTS_FILE || path.join(SRC(), "slack_posts.json");

export function moreSourcesOn(): boolean {
  if (dataSource()) return false;
  return (process.env.MORE_SOURCES ?? "").trim().toLowerCase() !== "off";
}

function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as T) : fallback;
}

export const blogPosts = (): BlogPost[] => (moreSourcesOn() ? readJson<BlogPost[]>(path.join(SRC(), "blog_posts.json"), []) : []);
export const slackPosts = (): SlackPost[] => (moreSourcesOn() ? readJson<SlackPost[]>(SLACK_POSTS_FILE(), []) : []);

/** ブログ記事の活動 id → 同じ記事の published id（カードを「ブログ済み」にするため） */
export function blogPublishedIds(activityIds: string[]): string[] {
  const byId = new Map(blogPosts().map((b) => [b.id, b.published_id]));
  return [...new Set(activityIds.map((id) => byId.get(id)).filter((x): x is string => !!x))];
}

export function moreActivities(): Activity[] {
  const blogs: Activity[] = blogPosts().map((b) => ({
    id: b.id,
    type: "blog",
    author_id: b.author_id,
    date: b.date,
    title: b.title,
    body: b.summary,
    channel: null,
    repo: null,
    url: b.url,
  }));
  const slack: Activity[] = slackPosts().map((s) => ({
    id: s.id,
    type: "slack",
    author_id: s.employee_id,
    date: s.posted_at.slice(0, 10),
    title: s.text.replace(/\s+/g, " ").slice(0, 40),
    body: s.text,
    channel: null,
    repo: null,
    url: s.permalink,
  }));
  return [...blogs, ...slack];
}
