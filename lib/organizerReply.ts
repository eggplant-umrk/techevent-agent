// 主催者への返事（X で返す下書き）の検査と、検査に通らなかったときの代わりの文。
// 送信はしない（画面でコピーするだけ）。画面（モック）からも使うので、ファイルやデータは読まない純粋な関数だけにする。
//
// 主催者は社外の人。社内の評価に当たる情報（忙しさ・予定の埋まり具合や中身・登壇回数・アンケートの反応・ほかの候補・社内の判断）は書かない。
// 社内の人には「さん」を付けない（「弊社の〇〇」）。X なので短く。

export const ORGANIZER_REPLY_MAX = 280;

/** 社内の評価・社内の事情に当たる言い方（主催者に見せない） */
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

/**
 * 主催者への返事の問題（コードで検査）。
 * name：進める社員のフルネーム（「早乙女 蓮」）。otherNames：ほかの社員のフルネーム（比較や名前の漏れを防ぐ）
 */
export function organizerReplyProblems(text: string, name: string, otherNames: string[]): string[] {
  const out: string[] = [];
  const t = text.trim();
  if (!t) return ["主催者への返事が空です"];
  if (t.length > ORGANIZER_REPLY_MAX) out.push(`主催者への返事が長すぎます（${t.length}字、${ORGANIZER_REPLY_MAX}字まで）`);
  for (const [re, what] of INTERNAL_EVALUATION) {
    const m = t.match(re);
    if (m) out.push(`主催者への返事に${what}が入っています（「${m[0]}」）。社内の評価に当たる情報は書かない`);
  }
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
