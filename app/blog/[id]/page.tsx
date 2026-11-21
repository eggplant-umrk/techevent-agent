// 架空の社内技術ブログの記事ページ（/blog/{id}）。人の画面の「直近のブログ」から開く。
// 本物の URL がある記事はそのページを開くので、ここに出すのは架空の記事だけ（lib/blogView.ts）。
import Link from "next/link";
import { notFound } from "next/navigation";
import { fictionalBlogPost } from "@/lib/blogView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function BlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = fictionalBlogPost(id);
  if (!post) notFound();
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      <p className="meta">
        <Link href="/">← ネタ帳Agent に戻る</Link>
      </p>
      <article className="surface pad-lg" aria-labelledby="post-title">
        <p
          role="note"
          style={{ margin: 0, padding: "8px 12px", borderRadius: 8, background: "var(--warn-bg, #fff4e5)", color: "var(--warn-fg, #7a4b00)", fontSize: 13 }}
        >
          架空の記事です。デモ用のデータで、実在の記事・人物とは関係ありません。
        </p>
        <h1 id="post-title" style={{ margin: "4px 0 0", fontSize: 22, lineHeight: 1.4 }}>
          {post.title}
        </h1>
        <p className="meta">
          {post.date}・{post.author}
          {post.tags.length > 0 && `・${post.tags.join("、")}`}
        </p>
        {post.target_reader && <p className="meta">こんな方に読んでほしい：{post.target_reader}</p>}
        {post.body ? (
          <div style={{ lineHeight: 1.9 }}>
            {post.body
              .split("。")
              .filter(Boolean)
              .map((s, i) => (
                <p key={i} style={{ margin: "0 0 8px" }}>
                  {s}。
                </p>
              ))}
          </div>
        ) : (
          <p className="meta">この記事の本文はまだ用意していません（発信の記録だけがあります）。</p>
        )}
      </article>
    </main>
  );
}
