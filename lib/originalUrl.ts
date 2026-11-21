// 活動の元のページ（PR・Slack の投稿・ブログ・リリース）の URL。架空の活動・架空のリンク（example.com など）は null。
// 候補の根拠から、カード詳細を開かずに1回で元のページに飛ぶために使う。
export function originalUrl(url: string | null | undefined): string | null {
  const u = url?.trim();
  if (!u || !/^https:\/\//.test(u)) return null;
  try {
    const host = new URL(u).hostname.toLowerCase();
    if (host === "example.com" || host.endsWith(".example.com") || host.endsWith(".invalid") || host === "localhost") return null;
  } catch {
    return null;
  }
  return u;
}
