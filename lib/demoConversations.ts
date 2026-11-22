// 「会話を貼って追加」の「例を入れる」ボタンの中身（架空の会話）。中身は data/demo_conversations.json にだけ書く。
// 画面（ブラウザ）からも読むので、fs などのサーバー専用のものは import しない（JSON はビルドのときに入る）。
import raw from "@/data/demo_conversations.json";

export interface DemoConversation {
  id: string;
  /** ボタンの文字 */
  label: string;
  /** 入力欄に入る会話 */
  text: string;
}

/** ボタンは3つまで */
export const MAX_DEMO_CONVERSATIONS = 3;

/** 形の合うものだけを、並びのとおり3つまで返す（ファイルを差し替えて形が崩れても、画面は落ちない） */
export function demoConversations(source: unknown = raw): DemoConversation[] {
  const list = (source as { conversations?: unknown })?.conversations;
  if (!Array.isArray(list)) return [];
  const out: DemoConversation[] = [];
  for (const c of list) {
    const x = c as Partial<DemoConversation>;
    if (typeof x?.id !== "string" || typeof x.label !== "string" || typeof x.text !== "string") continue;
    const label = x.label.trim();
    const text = x.text.trim();
    if (!x.id.trim() || !label || !text || out.some((o) => o.id === x.id)) continue;
    out.push({ id: x.id, label, text });
    if (out.length >= MAX_DEMO_CONVERSATIONS) break;
  }
  return out;
}
