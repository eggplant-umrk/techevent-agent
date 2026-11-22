// 主催者への返事（X で返す下書き）の検査と、検査に通らなかったときの代わりの文。
// 送信はしない（画面でコピーするだけ）。画面（モック）からも使うので、ファイルやデータは読まない純粋な関数だけにする。
//
// 主催者は社外の人。社内の評価に当たる情報（忙しさ・予定の埋まり具合や中身・登壇回数・アンケートの反応・ほかの候補・社内の判断）は書かない。
// 社内の人には「さん」を付けない（「弊社の〇〇」）。X なので短く。

import { askBackProblems, type ItemKey } from "./askBack";

export const ORGANIZER_REPLY_MAX = 280;

/** 社内の評価・社内の事情に当たる言い方（主催者に見せない） */
/** 連絡先の形（電話番号・メールアドレス）。返事に出たら、決まった文に差し替える（作り直さない） */
export const CONTACT_PROBLEM = "主催者への返事に電話番号やメールアドレスの形が入っています";
const PHONE = /(?:\+?81[\s-]*\(?0?\)?[\s-]*\d{1,4}|\(?0\d{1,4}\)?)[\s-]*\d{1,4}[\s-]*\d{3,4}(?!\d)/;
const EMAIL = /[\w.+-]+\s*@\s*[\w-]+(?:\.[\w-]+)+/;
export function contactProblem(text: string): string | null {
  const t = text.normalize("NFKC");
  const phone = t.match(PHONE);
  if (phone && phone[0].replace(/\D/g, "").length >= 10) return `${CONTACT_PROBLEM}（「${phone[0]}」）`;
  const mail = t.match(EMAIL);
  if (mail) return `${CONTACT_PROBLEM}（「${mail[0]}」）`;
  return null;
}

const INTERNAL_EVALUATION: Array<[RegExp, string]> = [
  [/忙し|多忙|稼働|負荷|工数|リソース|手が空|手一杯/, "忙しさ・稼働の話"],
  [/(予定|スケジュール|カレンダー)(の)?(が|は|も)?(埋ま|詰ま|空い|空き|立て込|厳し)|埋まり具合|空き状況/, "予定の埋まり具合"],
  [/(終日|午前|午後|日中|夕方|夜|朝)(の|は|に|も)?(予定|会議|打ち合わせ|ミーティング|用事)|(予定|会議|打ち合わせ|ミーティング|用事)(が|は|も)(あ|入)|(終日|午前|午後|日中|夕方|夜|朝)(は|も)?(空い|空き|埋ま|ふさが)|出張|休暇|有給|休み(を|が|の)/, "予定の中身"],
  [/アンケート|満足度|反応(が|も|は)?(良|よ|悪|高|低|上々)|好評|不評/, "アンケート・反応"],
  [/社内(の|で)?評価|評価(が|は)?(高|低)|人事|査定|スコア|点数|ランキング|順位/, "社内の評価"],
  [/候補(?!日)|第一希望|一番(手|に)|条件付き|自信あり|ほかの(人|メンバー)|他の(人|メンバー)/, "候補の比較・社内の判断"],
  [/登壇\s*\d+\s*回|登壇(経験|歴)|初登壇|初めての登壇|最後の登壇|最近登壇/, "登壇回数・登壇経験"],
  [/ネタ帳|カード|確認済み|未発信|週報|社内の投稿/, "社内の道具や記録の名前"],
];

// ---------------------------------------------------------------------------
// 追加の検査（docs/edge_cases.md の B4・J1・J3・B1）。当たったら、作り直しても残れば決まった文に差し替える（lib/heavy.ts）
// ---------------------------------------------------------------------------
const sentences = (t: string) => t.split(/[。！？!?\n]+/).filter((x) => x.trim());

/** 予定を思わせる言葉（社内の人の予定・会議・空き）。イベントそのものの予定（開催予定・ご予定）は除いてから見る */
const SCHEDULE_WORD = /予定|会議|打ち合わせ|打合せ|ミーティング|面談|来客|商談|空いて|空き|埋ま|先約|用事|出張|休暇/;
const EVENT_PLAN = /開催(?:を|の)?予定|実施(?:を|の)?予定|登壇(?:を|の)?予定|予定されて|ご予定/g;
/** 時刻・曜日・「来週」などの形（1文字の「朝」「夜」は人の名前に当たるので、助詞つきだけ） */
const TIME_FORM =
  /\d{1,2}\s*:\s*\d{2}|\d{1,2}\s*時(?:半|\s*\d{1,2}\s*分)?|午前|午後|正午|夕方|終日|[月火水木金土日]曜|(?:来|今|再来)週|明日|明後日|今日|(?:朝|夜|昼)(?:の|は|に|から|まで|イチ|一番)/;
/** 予定の中身：予定を思わせる言葉と、時刻・曜日の形が同じ文に出たら問題にする */
export function scheduleDetailProblem(text: string): string | null {
  for (const raw of sentences(text.normalize("NFKC"))) {
    const s = raw.replace(EVENT_PLAN, "");
    const w = s.match(SCHEDULE_WORD);
    const tm = s.match(TIME_FORM);
    if (w && tm) return `主催者への返事に予定の中身（「${w[0]}」と「${tm[0]}」）が入っています。社内の人の予定は書かない`;
  }
  return null;
}

/** 性別・年齢・国籍を表す言葉（社員データになく、推測もしない） */
const ATTRIBUTE = /女性|男性|女子|男子|女の(?:子|人|方)|男の(?:子|人|方)|若手|若い|年配|高齢|\d{1,3}\s*(?:歳|才|代)(?!目|表)|[一二三四五六七八九十]+(?:歳|才|代)(?!目|表)|年齢|性別|国籍|外国人|外国籍|日本人/;
export function attributeProblem(text: string): string | null {
  const m = text.normalize("NFKC").match(ATTRIBUTE);
  return m ? `主催者への返事に性別・年齢・国籍を表す言葉（「${m[0]}」）が入っています。人の属性は書かない` : null;
}

/** 機密を思わせる言い方と、約束の言い方。「確約はできません」のような打ち消しは約束にしない */
const SECRET = /社外秘|機密|非公開(?:の)?(?:情報|資料|数字|データ)|未公開|未発表|公開前|内部(?:の)?(?:数字|情報|資料|データ)|ここだけの|オフレコ|売上|解約率/;
const PROMISE = /(?:お約束|約束(?=し|いた|でき|です)|確約|保証(?=し|いた|でき))(?![^。！？!?]{0,10}(?:ません|ない|かね|ず))|必ず|間違いなく|絶対に?/;
export function secretOrPromiseProblem(text: string): string | null {
  const t = text.normalize("NFKC");
  const s = t.match(SECRET);
  if (s) return `主催者への返事に機密を思わせる言い方（「${s[0]}」）が入っています。社外秘に当たる内容は書かない`;
  const p = t.match(PROMISE);
  return p ? `主催者への返事に約束の言い方（「${p[0]}」）が入っています。本人に確認する前なので約束しない` : null;
}

/** 住所の形（郵便番号、または「◯県◯市…1-2-3」「◯丁目」「番地」）と、自宅・住所という言葉 */
const ADDRESS = /〒\s*\d{3}-?\d{4}|\d{3}-\d{4}(?!-?\d)|(?:東京都|北海道|(?:京都|大阪)府|[^\s、。]{2,3}県)[^\s、。]{1,12}(?:市|区|町|村|郡)[^\s、。]{0,16}?\d+(?:丁目|番地?|号|-\d+)|\d+丁目\d*|\d+番地|自宅|ご?住所|在住|住まい/;
/** 年収・給与の形（言葉と、金額の形） */
const SALARY = /年収|月収|給与|給料|月給|時給|年俸|手取り|賞与|ボーナス|報酬額|\d+(?:\.\d+)?\s*(?:万|億)\s*円|\d{1,3}(?:,\d{3})+\s*円|\d{4,}\s*円/;
/** 住所・年収：返事に出たら問題にする（電話番号・メールアドレスと同じく、形で見る） */
export function addressOrSalaryProblem(text: string): string | null {
  const t = text.normalize("NFKC");
  const a = t.match(ADDRESS);
  if (a) return `主催者への返事に住所の形（「${a[0]}」）が入っています。社員の住所は書かない`;
  const m = t.match(SALARY);
  return m ? `主催者への返事に年収・給与の形（「${m[0]}」）が入っています。社員の収入は書かない` : null;
}

/** 写しとみなす長さ：会話の原文と同じ並びが、これ以上続いたら問題にする */
export const COPY_MIN = 15;
const flatten = (t: string) => t.normalize("NFKC").replace(/[\s　]/g, "");
/**
 * 会話の原文の写し：返事の中に、会話の原文と COPY_MIN 字以上同じ並びがあり、それが確かめた項目の中にないとき。
 * 会話の原文は返事を作る AI に渡していないが、確かめた項目（イベント名・テーマなど）経由で混ざるのを防ぐ
 */
export function copiedFromConversationProblem(reply: string, conversation: string, facts: string): string | null {
  const c = flatten(conversation);
  if (c.length < COPY_MIN) return null;
  // 確かめた項目の値（「イベント名：〜」の〜）は、返事に書いてよい。先に区切りに置き換えて、その前後をまたぐ並びは写しとみなさない
  const values = facts
    .split(/\n/)
    .map((line) => flatten(line.replace(/^[^：:]*[：:]/, "")))
    .filter((v) => v.length >= 2)
    .sort((a, b) => b.length - a.length);
  let r = flatten(reply);
  for (const v of values) r = r.split(v).join("\u0000");
  for (const part of r.split("\u0000")) {
    for (let i = 0; i + COPY_MIN <= part.length; i++) {
      const w = part.slice(i, i + COPY_MIN);
      if (c.includes(w)) return `主催者への返事に、会話の原文と同じ並び（「${w}…」）が入っています。会話の文をそのまま写さない`;
    }
  }
  return null;
}

/** 返事を作ったときの材料（あれば、会話の写しの検査に使う） */
export interface ReplyContext {
  /** 貼られた会話の原文（返事を作る AI には渡していない） */
  conversation?: string | null;
  /** 返事を作る AI に渡した「確かめた項目」の文 */
  facts?: string | null;
  /** コードが選んだ、主催者に聞く項目（lib/askBack.ts）。渡したときだけ、その項目を聞いているかを見る */
  ask?: ItemKey[] | null;
  /** 未定だが今回は聞かない項目。渡したときだけ、触れていないかを見る */
  skip?: ItemKey[] | null;
}

/**
 * 主催者への返事に書いてよい値か（読めた項目の値を、返事を作る AI に渡す前に見る）。
 * 連絡先の形・属性を表す言葉・機密や約束の言い方・社内の評価に当たる言い方が入っていれば渡さない（返事に写ると検査に当たるため）
 */
export function safeForReply(value: string): boolean {
  if (contactProblem(value) || attributeProblem(value) || secretOrPromiseProblem(value) || scheduleDetailProblem(value)) return false;
  return !INTERNAL_EVALUATION.some(([re]) => re.test(value));
}

/**
 * 主催者への返事の問題（コードで検査）。
 * name：進める社員のフルネーム（「早乙女 蓮」）。otherNames：ほかの社員のフルネーム（比較や名前の漏れを防ぐ）。
 * ctx：会話の原文と確かめた項目（渡したときだけ、会話の写しを見る）
 */
export function organizerReplyProblems(text: string, name: string, otherNames: string[], ctx: ReplyContext = {}): string[] {
  const out: string[] = [];
  const t = text.trim();
  if (!t) return ["主催者への返事が空です"];
  if (t.length > ORGANIZER_REPLY_MAX) out.push(`主催者への返事が長すぎます（${t.length}字、${ORGANIZER_REPLY_MAX}字まで）`);
  const contact = contactProblem(t);
  if (contact) out.push(contact);
  for (const [re, what] of INTERNAL_EVALUATION) {
    const m = t.match(re);
    if (m) out.push(`主催者への返事に${what}が入っています（「${m[0]}」）。社内の評価に当たる情報は書かない`);
  }
  for (const p of [scheduleDetailProblem(t), attributeProblem(t), secretOrPromiseProblem(t), addressOrSalaryProblem(t)]) if (p) out.push(p);
  if (ctx.conversation) {
    const copied = copiedFromConversationProblem(t, ctx.conversation, ctx.facts ?? "");
    if (copied) out.push(copied);
  }
  if (ctx.ask || ctx.skip) out.push(...askBackProblems(t, ctx.ask ?? [], ctx.skip ?? []));
  const family = name.split(/[\s　]/)[0];
  if (!t.includes(family)) out.push(`主催者への返事に、進める人の名前（${family}）がありません`);
  if (new RegExp(`${family}\\s*(さん|様|さま)`).test(t)) out.push(`主催者への返事で社内の人（${family}）に敬称が付いています。「弊社の${family}」のように書く`);
  const flat = t.replace(/[\s　]/g, "");
  for (const other of otherNames) {
    const f = other.replace(/[\s　]/g, "");
    const fam = other.split(/[\s　]/)[0];
    // フルネーム、または姓（2文字以上）＋敬称・助詞で出てきたら名前の漏れとみなす
    if (flat.includes(f) || (fam.length >= 2 && fam !== family && new RegExp(`${fam}(さん|様|が|は|も|の|と)`).test(t))) {
      out.push(`主催者への返事にほかの社員の名前（${other}）が入っています`);
    }
  }
  return out;
}

/**
 * 検査に通らなかったときの代わりの文（コードで作る。名前・イベント名・テーマだけを使う）。
 * 本人にはまだ確認していないので、確約しない。
 * undecided：主催者に聞く項目の名前（コードが選んだもの。lib/askBack.ts の askBack。多くて3つ）
 */
export function fallbackOrganizerReply(p: {
  name: string;
  theme: string;
  organizer: string | null;
  eventName: string | null;
  undecided: string[];
}): string {
  const family = p.name.split(/[\s　]/)[0];
  const to = p.organizer ? `${p.organizer.replace(/(さん|様)$/, "")}さん、` : "";
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const ev = p.eventName ? `「${cut(p.eventName, 40)}」の件、` : "";
  const about = p.theme ? `「${cut(p.theme, 40)}」のお話で` : "";
  const ask = p.undecided.length ? `あわせて、${p.undecided.join("・")}が決まりましたら教えていただけると助かります。` : "";
  return `${to}ご連絡ありがとうございます！${ev}弊社の${family}が${about}お力になれそうです。いま本人に確認していますので、決まり次第あらためてご連絡します。${ask}`;
}
