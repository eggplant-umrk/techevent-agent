// 画面に出すエラーの文を、使う人向けの言葉にする。
//   AI（API）の失敗（529 {"type":"error",…} など）の生の文は画面に出さず、サーバーの記録（ログ）にだけ残す。
//   アプリが自分で出している日本語の理由（「上限に届いたので…」など）は、そのまま出す。

/** AI が混んでいる・断られた・落ちているときなど、種類ごとの言い方 */
export function apiErrorKind(err: unknown): "overloaded" | "rate_limited" | "server" | "auth" | "timeout" | "unreadable" | null {
  const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : null;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const name = err instanceof Error ? err.constructor?.name ?? err.name : "";
  const code = status ?? (Number(msg.match(/^(\d{3})\b/)?.[1]) || null);
  if (code === 529 || /overloaded/i.test(msg)) return "overloaded";
  if (code === 429 || /rate.?limit/i.test(msg)) return "rate_limited";
  if (code === 401 || code === 403 || /authentication|api.?key|permission/i.test(msg)) return "auth";
  if (code !== null && code >= 500) return "server";
  if (/timeout|timed out/i.test(name + msg)) return "timeout";
  if (/Connection|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i.test(name + msg)) return "timeout";
  if (/Unexpected token|JSON|is not valid/i.test(msg)) return "unreadable";
  if (code !== null && code >= 400) return "server";
  if (/\{"type":"error"/.test(msg)) return "server";
  return null;
}

/**
 * 画面に出す文。retryLabel は押し直すボタンの名前（「もう一度探す」など）。
 * 生の文はサーバーの記録にだけ残す（where は記録の見出し）。
 */
export function userErrorText(err: unknown, opts: { where?: string; retryLabel?: string; fallback?: string } = {}): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const hasStatus = typeof (err as { status?: unknown })?.status === "number";
  // アプリの日本語の理由は、そのまま（API の失敗〔status つき〕だけは種類で言い直す）
  const kind = hasStatus || !isOwnMessage(raw) ? apiErrorKind(err) : null;
  const again = opts.retryLabel ? `少し待ってから「${opts.retryLabel}」を押してください` : "少し待ってから、もう一度押してください";
  if (kind || !isOwnMessage(raw)) {
    // 中身はサーバーの記録にだけ（キーは文に入らないが、念のため長い英数字は伏せる）
    console.error(`[エラー${opts.where ? `：${opts.where}` : ""}] ${raw.replace(/sk-[A-Za-z0-9_-]{8,}/g, "（キー）").slice(0, 2000)}`);
  }
  switch (kind) {
    case "overloaded":
      return `AI が混んでいます。${again}`;
    case "rate_limited":
      return `AI の利用が一時的に混み合っています。1分ほど待ってから、${opts.retryLabel ? `「${opts.retryLabel}」を押してください` : "もう一度押してください"}`;
    case "server":
      return `AI の側で一時的な問題が起きています。${again}`;
    case "auth":
      return "AI につなぐ設定に問題があるため、使えませんでした。発表用の設定（API キー）を確かめてください";
    case "timeout":
      return `AI から返事が届きませんでした。${again}`;
    case "unreadable":
      return `AI の返事を読み取れませんでした。${again}`;
  }
  if (isOwnMessage(raw)) return raw;
  return opts.fallback ?? `うまくいきませんでした。${again}`;
}

/** アプリが自分で出している理由の文か（日本語で、生のエラーの形〔JSON・英語だけ〕でない） */
function isOwnMessage(msg: string): boolean {
  if (!msg || /\{"/.test(msg)) return false;
  return /[぀-ヿ一-鿿]/.test(msg);
}
