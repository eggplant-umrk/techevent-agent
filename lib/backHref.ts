// アプリの中のページ（/blog/{id}・/events/{id}）の「戻る」の行き先。リンクに付けてきた ?mock・?debug・タブ・人・イベントをそのまま戻す
export function backHref(sp: Record<string, string | string[] | undefined>, fallbackTab: string): string {
  const q = new URLSearchParams();
  const one = (k: string) => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  for (const k of ["mock", "debug"]) if (one(k) !== undefined) q.set(k, "");
  q.set("tab", one("tab") || fallbackTab);
  for (const k of ["person", "archive", "inbox"]) {
    const v = one(k);
    if (v) q.set(k, v);
  }
  return `/?${q.toString()}`.replace(/=(?=&|$)/g, "");
}
