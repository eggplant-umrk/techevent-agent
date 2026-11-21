// 依頼の会話の中にある、イベントの告知ページの URL（connpass など）を取り出す（コード。AI は使わない）。
// 会話の中に本当にある文字列だけを使う（取り出した URL がそのまま本文に含まれることを確かめる）。
// 画面（モック）からも使うので、ファイルやデータを読まない純粋な関数だけにする。

/** イベントの告知に使われるサイト（ホスト名の末尾で見る） */
const EVENT_HOSTS = ["connpass.com", "doorkeeper.jp", "techplay.jp", "peatix.com", "eventbrite.com", "eventbrite.co.jp", "lu.ma", "luma.com", "compass.connpass.com"];

/** URL の終わりに付きやすい句読点・かっこ（日本語の文の中に書かれたとき） */
const TRAILING = /[。、，．,.!！?？)）」』】\]>]+$/;

export function eventUrlsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>「」『』（）()【】]+/g)) {
    const url = m[0].replace(TRAILING, "");
    if (!text.includes(url)) continue; // 会話の中に本当にある URL だけ
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      continue;
    }
    if (!EVENT_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}
