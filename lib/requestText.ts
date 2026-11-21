// 依頼の文がありそうかを見る入口のチェック（コード、API の前）。受信箱（lib/inbox.ts）と Slack ボット（scripts/slack/core.ts）の両方で使う。
// ほかのファイルを読み込まない（Slack ボットが受信箱の重い処理を読み込まないようにするため）

/** 意味のある文字（かな・漢字・英字）がこれより少ない文は、依頼の文がないとみなす */
export const MIN_MEANINGFUL_CHARS = 3;

/** 依頼の文がありそうか（コード）。URL とアカウント名（@…）を除いて、かな・漢字・英字が少なすぎなければ true */
export function hasRequestText(text: string): boolean {
  const t = text
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/www\.\S+/gi, " ")
    .replace(/@[A-Za-z0-9_]+/g, " ");
  const meaningful = t.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}A-Za-z]/gu) ?? [];
  return meaningful.length >= MIN_MEANINGFUL_CHARS;
}
