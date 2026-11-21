// テスト用の架空の X（DM・リプライ）の会話 3件。人物・アカウント・イベントはすべて架空。
// raw は「Agent がこう読み取った」という偽の読み取り（テストでは Agent を呼ばない）。
// わざと怪しい読み取り（候補日を日付として返す・会話にない引用）も混ぜて、コードの検査が未定に落とすかを確かめる。
import type { RawIntake } from "../../lib/intake";

export interface XConversation {
  id: string;
  title: string;
  received_at: string;
  text: string;
  raw: RawIntake;
  expected: {
    event_name: string | null;
    date: string | null;
    format: string | null;
    theme: string | null;
    organizer: string | null;
    nominee_id: string | null;
    /** 未定になるべき項目 */
    undecided: string[];
    /** 指名の注意点に含まれるべき言葉（指名なし・確かめられたときは null） */
    nominee_note_has: string | null;
  };
}

const q = (value: string | null, quote: string | null = value) => ({ value, quote });

export const X_CONVERSATIONS: XConversation[] = [
  {
    // 1. くだけたDMが続き、日程と形式があとから決まる。指名なし
    id: "x1",
    title: "くだけたDM・日程があとから決まる",
    received_at: "2026-11-21T10:00:00+09:00",
    text: `@kumoi_llmops（雲井 / Tokyo LLM Ops 夜会）
突然のDMすみません！「Tokyo LLM Ops 夜会」っていう小さめの勉強会やってるんですが、LayerXさんからどなたか話してもらえないかなーと思って🙏

@kumoi_llmops
テーマはLLMの評価まわりだとめちゃ嬉しいです

@layerx_techpr
ご連絡ありがとうございます！ぜひ前向きに検討させてください。日程や形式は決まっていますか？

@kumoi_llmops
1月下旬で調整中です！形式はLT（10分）を考えてます

@kumoi_llmops
日程決まりました！2027/1/29（金）19時〜です
あ、主催は僕（雲井）です。よろしくお願いします〜`,
    raw: {
      event_name: q("Tokyo LLM Ops 夜会", "「Tokyo LLM Ops 夜会」っていう小さめの勉強会"),
      date: q("2027-01-29", "日程決まりました！2027/1/29（金）19時〜です"),
      format: q("LT（10分）", "形式はLT（10分）を考えてます"),
      theme: q("LLMの評価まわり", "テーマはLLMの評価まわりだとめちゃ嬉しいです"),
      organizer: q("雲井", "主催は僕（雲井）です"),
      nominee: q(null),
    },
    expected: {
      event_name: "Tokyo LLM Ops 夜会",
      date: "2027-01-29",
      format: "LT（10分）",
      theme: "LLMの評価まわり",
      organizer: "雲井",
      nominee_id: null,
      undecided: [],
      nominee_note_has: null,
    },
  },
  {
    // 2. リプライから始まる指名。日程・形式・テーマはまだ決まっていない
    id: "x2",
    title: "リプライからの指名・日程未定",
    received_at: "2026-11-21T11:30:00+09:00",
    text: `@frontend_hiroba
@layerx_techpr 先日の百瀬さんの記事、めちゃくちゃ参考になりました！

@layerx_techpr
ありがとうございます、本人にも伝えます！

@frontend_hiroba
もしよければ「フロントエンド広場」で百瀬さんにお話ししてもらえたりしませんか…？
日程はまだ決まってなくて、春ごろを考えてます。オンライン開催です

@frontend_hiroba
中の人は谷口です、DMでも大丈夫です！`,
    raw: {
      event_name: q("フロントエンド広場", "「フロントエンド広場」で百瀬さんにお話ししてもらえたりしませんか"),
      // 春ごろ＝決まっていない。偽の読み取りがうっかり日付を入れても、コードが未定に落とす
      date: q("2027-04-01", "日程はまだ決まってなくて、春ごろを考えてます"),
      format: q(null),
      theme: q(null),
      organizer: q("谷口", "中の人は谷口です"),
      nominee: q("百瀬さん", "百瀬さんにお話ししてもらえたりしませんか"),
    },
    expected: {
      event_name: "フロントエンド広場",
      date: null,
      format: null,
      theme: null,
      organizer: "谷口",
      nominee_id: "e012",
      undecided: ["date", "format", "theme"],
      nominee_note_has: null,
    },
  },
  {
    // 3. 候補日が2つ・社員にいない人の指名・会話にない読み取りが混じる
    id: "x3",
    title: "候補日が2つ・いない人の指名",
    received_at: "2026-11-21T13:00:00+09:00",
    text: `山辺（ゆるSRE会）
こんにちは！ゆるSRE会の山辺です。LayerXでSREやってる佐藤さんにお願いしたくてご連絡しました

山辺（ゆるSRE会）
日程は2/18か2/25のどちらかで、まだ確定してないです
形式は20分のトーク、テーマはオンコールの話が聞けたら最高です`,
    raw: {
      // 会話にない言い方（「ゆるSRE会 vol.3」）は確かめられないので未定
      event_name: q("ゆるSRE会 vol.3", "ゆるSRE会 vol.3"),
      date: q("2027-02-18", "日程は2/18か2/25のどちらかで、まだ確定してないです"),
      format: q("20分のトーク", "形式は20分のトーク"),
      theme: q("オンコールの話", "テーマはオンコールの話が聞けたら最高です"),
      organizer: q("山辺", "ゆるSRE会の山辺です"),
      nominee: q("佐藤さん", "SREやってる佐藤さんにお願いしたくて"),
    },
    expected: {
      event_name: null,
      date: null,
      format: "20分のトーク",
      theme: "オンコールの話",
      organizer: "山辺",
      nominee_id: null,
      undecided: ["event_name", "date"],
      nominee_note_has: "佐藤さん",
    },
  },
];
