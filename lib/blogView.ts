// 人の画面の「直近のブログ」と、架空の記事のページ（/blog/{id}）用のデータ。
// その人のブログ = data/sources/blog_posts.json の記事（本文の要約つき）＋ published の「メンバーのブログ」（要約がなければなし）。
// 本物の URL がある記事はそのページを開く。架空の記事（URL が example.com など）はアプリの中の /blog/{id} を開く。
import { employeeById, published } from "./data";
import { blogPosts } from "./moreSources";

export interface BlogItem {
  /** blog_posts の id（blg001）か、要約のない記事は published の id（pub002） */
  id: string;
  title: string;
  date: string;
  /** 本文の要約。ない記事は null */
  summary: string | null;
  /** 押したときの行き先。本物の記事は外の URL、架空の記事は /blog/{id} */
  href: string;
  /** true なら外のページ（新しいタブで開く） */
  external: boolean;
  fictional: boolean;
}

const FICTIONAL_HOSTS = /^https?:\/\/([^/]+\.)?(example\.(com|org|net)|example|test|invalid|localhost)(\/|:|$)/i;

export function isFictionalUrl(url: string | null | undefined): boolean {
  return !url || FICTIONAL_HOSTS.test(url);
}

/** その人のブログ（新しい順、すべて）。画面は先頭3件を出し、残りは「すべて見る」で開く */
export function blogsOf(employeeId: string): BlogItem[] {
  const posts = blogPosts().filter((b) => b.author_id === employeeId);
  const covered = new Set(posts.map((b) => b.published_id));
  const items: BlogItem[] = posts.map((b) => {
    const fictional = isFictionalUrl(b.url);
    return { id: b.id, title: b.title, date: b.date, summary: b.summary, href: fictional ? `/blog/${b.id}` : b.url, external: !fictional, fictional };
  });
  for (const p of published()) {
    if (p.author_id !== employeeId || p.genre !== "メンバーのブログ" || covered.has(p.id)) continue;
    const fictional = isFictionalUrl(p.url);
    items.push({ id: p.id, title: p.title, date: p.published_at.slice(0, 10), summary: null, href: fictional ? `/blog/${p.id}` : p.url, external: !fictional, fictional });
  }
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** /blog/{id} のページ用（架空の記事だけ。本物の URL の記事はそのページを開くので、ここでは出さない） */
export function fictionalBlogPost(id: string) {
  const b = blogPosts().find((x) => x.id === id);
  if (b && isFictionalUrl(b.url)) {
    const p = published().find((x) => x.id === b.published_id);
    return { id: b.id, title: b.title, date: b.date, author: employeeById(b.author_id)?.name ?? "", body: b.summary, tags: p?.tags ?? [], target_reader: p?.target_reader ?? null };
  }
  const p = published().find((x) => x.id === id && x.genre === "メンバーのブログ");
  if (p && isFictionalUrl(p.url)) {
    return { id: p.id, title: p.title, date: p.published_at.slice(0, 10), author: employeeById(p.author_id)?.name ?? "", body: null, tags: p.tags, target_reader: p.target_reader };
  }
  return null;
}
