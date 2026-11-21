// アプリの中のページ（架空のブログ記事・架空のイベントページ）へのリンクに、戻り先の手がかりを付ける。
// 今の ?mock・?debug と、開いていた画面（タブ・人・イベント）を付けておき、ページ側の「戻る」でそのまま戻す。
// （?mock が外れると本物の API を使う画面に戻ってしまうため）
export function withReturn(href: string, ctx: Record<string, string>): string {
  if (/^https?:\/\//.test(href)) return href; // 外のページはそのまま
  const q = new URLSearchParams();
  if (typeof window !== "undefined") {
    const cur = new URLSearchParams(window.location.search);
    for (const k of ["mock", "debug"]) if (cur.has(k)) q.set(k, "");
  }
  for (const [k, v] of Object.entries(ctx)) q.set(k, v);
  const s = q.toString();
  return s ? `${href}${href.includes("?") ? "&" : "?"}${s}` : href;
}
