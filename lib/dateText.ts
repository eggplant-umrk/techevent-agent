// 人に見せる文（主催者への返事・声かけの下書き）に入れる日程の形。曜日はコードで出す（AI に出させない）。
// - 「1月19日（火）」。年が今年と違うときだけ「2027年1月19日（火）」
// - 画面（モック）からも使うので、ファイルやデータ・API は読まない純粋な関数だけにする
import { todayJst } from "./clock";

const DOW = "日月火水木金土";
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD を年・月・日と曜日に分ける。暦にない日付・形の違うものは null */
function parts(iso: string | null | undefined): { y: number; m: number; d: number; dow: string } | null {
  const m = (iso ?? "").trim().match(ISO);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d, dow: DOW[t.getUTCDay()] };
}

/**
 * 日程を人に見せる形にする：「1月19日（火）」。年が今年（today の年）と違うときだけ年を付ける。
 * YYYY-MM-DD でないもの（「未定」など）・暦にない日付は、そのまま返す
 */
export function displayDate(iso: string | null | undefined, today: string = todayJst()): string {
  const p = parts(iso);
  if (!p) return (iso ?? "").trim();
  const year = String(p.y) !== today.slice(0, 4) ? `${p.y}年` : "";
  return `${year}${p.m}月${p.d}日（${p.dow}）`;
}

/**
 * AI が書いた文の中の開催日を、コードで決まった形に直す（作り直さない）。
 * - 「2027-01-19」「2027/1/19」「2027.01.19」の形で書かれた開催日 → 「2027年1月19日（火）」（年は displayDate の決まり）
 * - 開催日の月日に付いた曜日が違う（「1月19日（水）」）→ 正しい曜日に直す
 * 開催日でない日付には触らない。iso が YYYY-MM-DD でなければ何もしない
 */
export function fixEventDateText(text: string, iso: string | null | undefined, today: string = todayJst()): string {
  const p = parts(iso);
  if (!p || !text) return text;
  const shown = displayDate(iso, today);
  // 数字だけの形（区切りは - / . 、月日の頭の 0 はあってもなくてもよい）。後ろに曜日のかっこが付いていれば一緒に置き換える
  const numeric = new RegExp(`(?<!\\d)${p.y}\\s*[-/.]\\s*0?${p.m}\\s*[-/.]\\s*0?${p.d}(?!\\d)(?:\\s*[（(]\\s*[${DOW}]\\s*(?:曜日?)?\\s*[)）])?`, "g");
  let out = text.replace(numeric, shown);
  // 月日の形に付いた曜日が違うとき
  const withDow = new RegExp(`(?<!\\d)(${p.m}\\s*月\\s*${p.d}\\s*日\\s*[（(]\\s*)([${DOW}])(\\s*(?:曜日?)?\\s*[)）])`, "g");
  out = out.replace(withDow, (_all, head: string, _dow: string, tail: string) => `${head}${p.dow}${tail}`);
  return out;
}
