// 「会話を貼って追加」の「例を入れる」ボタンの中身（架空の会話）。中身は data/demo_conversations.json にだけ書く。
// 画面（ブラウザ）からも読むので、fs などのサーバー専用のものは import しない（JSON はビルドのときに入る）。
import raw from "@/data/demo_conversations.json";

export interface DemoConversation {
  id: string;
  /** ボタンの文字 */
  label: string;
  /** 入力欄に入る会話 */
  text: string;
  /** この例の会話が受信箱にあるときだけ押せる（例3＝例2の続き → "ex2"） */
  requires?: string;
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
    const requires = typeof x.requires === "string" && x.requires.trim() ? x.requires.trim() : undefined;
    out.push(requires ? { id: x.id, label, text, requires } : { id: x.id, label, text });
    if (out.length >= MAX_DEMO_CONVERSATIONS) break;
  }
  // 並びにない例を requires にしていたら、外す（押せないままにしない）
  return out.map((c) => (c.requires && !out.some((o) => o.id === c.requires) ? { id: c.id, label: c.label, text: c.text } : c));
}

/** 空白・改行の違いをならす（全部取る） */
const squash = (t: string) => t.replace(/[\s　]+/g, "");

/** 受信箱の依頼の会話に、どの例の会話がまるごと入っているか（例の id。続きの会話で更新された依頼も、前の会話を含むので入る） */
export function demoIdsIn(text: string, list: DemoConversation[] = demoConversations()): string[] {
  const mine = squash(text ?? "");
  if (!mine) return [];
  return list.filter((c) => {
    const key = squash(c.text);
    return key.length > 0 && mine.includes(key);
  }).map((c) => c.id);
}

/** 押せないときの一言（例：「例2を入れると使えます」）。押せるなら null */
export function lockedNote(c: DemoConversation, presentIds: Iterable<string>, list: DemoConversation[] = demoConversations()): string | null {
  if (!c.requires) return null;
  const present = new Set(presentIds);
  if (present.has(c.requires)) return null;
  const need = list.find((o) => o.id === c.requires);
  const short = (need?.label ?? c.requires).split("：")[0];
  return `${short}を入れると使えます`;
}
