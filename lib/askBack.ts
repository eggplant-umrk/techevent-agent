// 依頼の項目（読めた値・未定）を1つの並びにし、主催者に聞き返す項目をコードで選ぶ。
// - 項目：これまでの5つ（イベント名・日程・形式・テーマ・主催者の名前）と、足した7つ（持ち時間・人数・対象者・会場・録画・資料の公開・謝礼・交通費・返事の期限）
// - 聞き返すのは多くて ASK_MAX 個（X の返事は短いため）。どれを聞くかは ASK_PRIORITY の順でコードが決め、AI は言い回しだけを書く
// - 画面（モック）からも使うので、ファイルやデータ・API は読まない純粋な関数だけにする（型だけを読む）
import type { SpeakingRequest } from "./data";

/** 足した項目（会話の一節を引用させ、コードで照合する。lib/intake.ts の checkExtras） */
export type ExtraField = "duration" | "audience_size" | "audience" | "venue" | "recording" | "reward" | "reply_deadline";
export const EXTRA_LABEL: Record<ExtraField, string> = {
  duration: "持ち時間",
  audience_size: "人数",
  audience: "対象者",
  venue: "会場",
  recording: "録画・資料の公開",
  reward: "謝礼・交通費",
  reply_deadline: "返事の期限",
};
export const EXTRA_FIELDS = Object.keys(EXTRA_LABEL) as ExtraField[];
/** 項目ごとの長さの上限（これより長いものは項目として使わない） */
export const EXTRA_MAX: Record<ExtraField, number> = { duration: 20, audience_size: 20, audience: 40, venue: 40, recording: 40, reward: 40, reply_deadline: 30 };

export type ItemKey = "event_name" | "date" | "format" | "theme" | "organizer" | ExtraField;
export const ITEM_LABEL: Record<ItemKey, string> = {
  event_name: "イベント名",
  date: "日程",
  format: "形式",
  theme: "テーマ",
  organizer: "主催者の名前",
  ...EXTRA_LABEL,
};
/** 画面に並べる順 */
export const ITEM_ORDER: ItemKey[] = ["event_name", "date", "format", "duration", "theme", "audience_size", "audience", "venue", "recording", "reward", "reply_deadline", "organizer"];
/**
 * 聞き返す優先度（先のものほど先に聞く）。
 * 日程 > 持ち時間 > 人数・対象者 > 会場・形式 > （テーマ・イベント名） > 録画・資料の公開 > 謝礼・交通費 > 返事の期限 > 主催者の名前
 */
export const ASK_PRIORITY: ItemKey[] = ["date", "duration", "audience_size", "audience", "venue", "format", "theme", "event_name", "recording", "reward", "reply_deadline", "organizer"];
/** 主催者への返事で聞く項目の上限 */
export const ASK_MAX = 3;

/** 依頼の項目1つ。value が null なら未定（会話の中で決まっていない・確かめられなかった） */
export interface RequestItem {
  key: ItemKey;
  label: string;
  value: string | null;
}

type RequestLike = Pick<SpeakingRequest, "event" | "intake" | "theme" | "requester" | "reply_deadline">;

/** 形式に書かれた分数（「LT（10分）」→「10分」）。なければ null */
export function minutesInFormat(format: string | null | undefined): string | null {
  const m = (format ?? "").normalize("NFKC").match(/(\d{1,3})\s*分/);
  return m ? `${m[1]}分` : null;
}

/**
 * 依頼の項目を、画面に並べる順で返す（読めた値つき・未定は value が null）。
 * - 読み取っていない項目は並べない（サンプルの依頼の人数、足した項目を読む前に届いた依頼）。聞き返しもしない
 * - 持ち時間は、読み取った値がなければ形式に書かれた分数を使う（「LT10分」）
 */
export function requestItems(r: RequestLike | null | undefined): RequestItem[] {
  if (!r) return [];
  const it = r.intake ?? null;
  const ev = r.event ?? null;
  const ex = it?.extra ?? null;
  const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  const values: Partial<Record<ItemKey, string | null>> = {};
  /** known：値があれば載せる。asked：読み取りをした項目（値がなければ未定として載せる） */
  const put = (key: ItemKey, value: string | null | undefined, asked: boolean) => {
    const v = clean(value);
    if (v || asked) values[key] = v;
  };
  put("event_name", ev?.title ?? it?.event_name, !!it);
  put("date", ev?.date ?? it?.date, !!it);
  put("format", ev?.format ?? it?.format, !!it);
  put("theme", r.theme ?? it?.theme, !!it);
  put("organizer", r.requester?.contact_name || it?.organizer, !!it);
  put("duration", (ev?.duration_min ? `${ev.duration_min}分` : null) ?? ex?.duration ?? minutesInFormat(it?.format), !!ex);
  put("audience_size", ex?.audience_size, !!ex);
  put("audience", ev?.audience ?? ex?.audience, !!ex);
  put("venue", ev ? (ev.online ? "オンライン" : ev.venue) : ex?.venue, !!ex);
  put("recording", ex?.recording, !!ex);
  put("reward", ex?.reward, !!ex);
  put("reply_deadline", r.reply_deadline ?? ex?.reply_deadline, !!ex);
  return ITEM_ORDER.filter((k) => k in values).map((key) => ({ key, label: ITEM_LABEL[key], value: values[key] ?? null }));
}

/** 未定の項目を、聞き返す優先度の順に並べる */
export function undecidedByPriority(items: RequestItem[]): RequestItem[] {
  return ASK_PRIORITY.flatMap((k) => items.filter((i) => i.key === k && i.value === null));
}

/** 主催者への返事で聞く項目（未定のうち、優先度の高い順に ASK_MAX 個まで）。決めるのはコード */
export function askBack(items: RequestItem[]): RequestItem[] {
  return undecidedByPriority(items).slice(0, ASK_MAX);
}

/** 未定だが、今回の返事では聞かない項目（優先度が低く、ASK_MAX に入らなかったもの） */
export function notAsked(items: RequestItem[]): RequestItem[] {
  return undecidedByPriority(items).slice(ASK_MAX);
}

/** 聞いていることが分かる言葉（広め）。聞く項目ごとに、返事のどこかにあればよい */
const ASK_WORDS: Record<ItemKey, RegExp> = {
  date: /日程|日時|開催日|日にち|いつ/,
  duration: /持ち時間|時間|何分|分数/,
  audience_size: /人数|規模|何名|何人/,
  audience: /対象|参加者|来場者|層|レベル/,
  venue: /会場|場所|開催地|オンライン/,
  format: /形式/,
  theme: /テーマ/,
  event_name: /イベント名|名称|イベントの名前/,
  recording: /録画|配信|アーカイブ|資料|公開/,
  reward: /謝礼|交通費/,
  reply_deadline: /期限|いつまで|締め?切/,
  organizer: /名前/,
};
/** 聞かない項目に触れたとみなす言葉（狭め。ふつうの文に出やすい「テーマ」「時間」などは入れない） */
const NOT_ASK_WORDS: Partial<Record<ItemKey, RegExp>> = {
  duration: /持ち時間|何分/,
  audience_size: /人数|何名|何人/,
  audience: /対象者/,
  venue: /会場/,
  format: /形式/,
  recording: /録画|アーカイブ/,
  reward: /謝礼|交通費/,
  reply_deadline: /期限|いつまで/,
};

/**
 * 主催者への返事が、コードの選んだ項目だけを聞いているか（コードで検査）。
 * - 聞く項目（ask）に当たる言葉が1つもない → 問題
 * - 未定だが聞かない項目（skip）に当たる言葉がある → 問題
 */
export function askBackProblems(reply: string, ask: ItemKey[], skip: ItemKey[]): string[] {
  const t = reply.normalize("NFKC");
  const out: string[] = [];
  for (const k of ask) if (!ASK_WORDS[k].test(t)) out.push(`主催者への返事で、聞くと決めた項目（${ITEM_LABEL[k]}）を聞いていません`);
  for (const k of skip) {
    const m = NOT_ASK_WORDS[k] ? t.match(NOT_ASK_WORDS[k]!) : null;
    if (m) out.push(`主催者への返事で、今回は聞かない項目（${ITEM_LABEL[k]}）に触れています（「${m[0]}」）。聞くのは決めた項目だけ`);
  }
  return out;
}

/** 声かけの下書き（社員あて）に入れる、人数と持ち時間。読み取っていない項目は入れない */
export const CONFIRMING = "主催者に確認中";
export function outreachFacts(items: RequestItem[]): Array<{ key: "audience_size" | "duration"; label: string; value: string | null; text: string }> {
  return (["audience_size", "duration"] as const).flatMap((key) => {
    const i = items.find((x) => x.key === key);
    return i ? [{ key, label: i.label, value: i.value, text: `${i.label}：${i.value ?? CONFIRMING}` }] : [];
  });
}

/** 声かけ文に、人数と持ち時間（分かっていれば値、分からなければ「主催者に確認中」）が入っているか。足りない項目を返す */
export function outreachFactsMissing(message: string, items: RequestItem[]): Array<{ label: string; value: string | null }> {
  const t = message.normalize("NFKC");
  // 「確認中」は、その項目の名前と同じ文にあること（人数だけ確認中と書いて、持ち時間に数字を作るのを通さない）
  const sentences = t.split(/[。!?\n]+/);
  return outreachFacts(items).filter((f) => {
    if (f.value === null) return !sentences.some((x) => x.includes(f.label) && x.includes("確認中"));
    const digits = f.value.normalize("NFKC").match(/\d+/g) ?? [];
    return digits.length ? !digits.every((d) => t.includes(d)) : !t.includes(f.value.normalize("NFKC"));
  });
}

/** 足りない項目を、声かけ文の最後に足す1行（コードで足す） */
export function outreachFactsLine(missing: Array<{ label: string; value: string | null }>): string {
  return `（${missing.map((m) => `${m.label}は${m.value ?? CONFIRMING}`).join("、")}です）`;
}
