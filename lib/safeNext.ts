// 合言葉のあとの移動先（/access?next=…）。同じサイトの中のパスだけにする（外のサイトへ飛ばさない）。
// \ は / に戻してから見る（ブラウザは /\evil.example を //evil.example と同じに扱うため）
export function safeNext(next: string | null | undefined): string {
  const n = (next ?? "/").replace(/\\/g, "/");
  if (!n.startsWith("/") || n.startsWith("//") || /[\u0000-\u001f]/.test(n)) return "/";
  return n;
}
