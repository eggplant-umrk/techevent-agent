// 日程が決まっていない依頼（「2月か3月」「春ごろ」など）で、候補の人の「空いていそうな日」を出す（AI は使わない）。
// - 日程の手がかり（会話にある言い回しそのまま）を、決まった言い方だけ期間に直す。分からなければ今日から8週間
// - 期間の中から、平日の夜（既定 19〜21時。設定で変えられる）に予定がなく、終日の予定もない日を最大3日。なるべく週をばらす
// - 平日から、日本の祝日（振替休日を含む。一覧はこのファイルに持つ）と年末年始（12/29〜1/3、設定で外せる）を除く
// - カレンダーがない人は出さない（「予定は不明」）。予定が分かる範囲より先の日も出さない（空いているとは言えないため）
// 主催者には予定の中身や埋まり具合を伝えない。返事に入れてよいのは「この日あたりなら調整しやすそう（本人に確認する）」だけで、
// 入れるかどうかは技術広報が選ぶ（ここでは材料を作るだけ）。画面（モック）からも使えるよう、ファイルは読まない純粋な関数にする。
import type { BusySlot } from "./ics";

const JST = 9 * 3600_000;
const DAY = 86_400_000;
const DEFAULT_WEEKS = 8;
export const MAX_SUGGESTIONS = 3;

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
const hourEnv = (v: string | undefined, d: number) => {
  const n = Number(v);
  return v && Number.isInteger(n) && n >= 0 && n <= 24 ? n : d;
};
/** 空いていそうか見る時間帯（日本時間）。.env の DATE_SUGGEST_START_HOUR・DATE_SUGGEST_END_HOUR（既定 19・21） */
export function suggestHours(): { start: number; end: number } {
  const start = hourEnv(process.env.DATE_SUGGEST_START_HOUR, 19);
  const end = hourEnv(process.env.DATE_SUGGEST_END_HOUR, 21);
  return end > start ? { start, end } : { start: 19, end: 21 };
}

// ---------------------------------------------------------------------------
// 日付の小道具（日本時間の日付 YYYY-MM-DD）
// ---------------------------------------------------------------------------
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const dayMs = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - JST;
};
const dateOf = (ms: number) => new Date(ms + JST).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => dateOf(dayMs(date) + n * DAY);
const dow = (date: string) => new Date(dayMs(date) + JST).getUTCDay();
const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
/** 「1月20日（水）」 */
export const dateLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日（${WEEKDAY[dow(date)]}）`;

// ---------------------------------------------------------------------------
// 手がかり → 期間
// ---------------------------------------------------------------------------
export interface Period {
  /** 含む */
  from: string;
  /** 含む */
  to: string;
  /** 使う人向けの説明（「2月〜3月」「今日から8週間（手がかりなし）」など） */
  label: string;
  /** 手がかりを期間に直せたか（false なら今日から8週間） */
  from_hint: boolean;
}

const SEASON: Record<string, [number, number]> = { 春: [3, 5], 夏: [6, 8], 秋: [9, 11], 冬: [12, 2] };
const PART: Record<string, [number, number | null]> = { 上旬: [1, 10], 初旬: [1, 10], はじめ: [1, 10], 初め: [1, 10], 中旬: [11, 20], 下旬: [21, null], 末: [21, null], 終わり: [21, null] };

/** 月の範囲（startM 月 startD 日 〜 endM 月 endD 日。endD が null なら月末）を、今日より後にくる年に置く */
function place(today: string, startM: number, startD: number, endM: number, endD: number | null): { from: string; to: string } {
  const ty = Number(today.slice(0, 4));
  for (const y of [ty, ty + 1]) {
    const ey = endM < startM ? y + 1 : y;
    const to = ymd(ey, endM, endD ?? lastDay(ey, endM));
    if (to >= today) return { from: ymd(y, startM, Math.min(startD, lastDay(y, startM))), to };
  }
  const y = ty + 1;
  return { from: ymd(y, startM, startD), to: ymd(endM < startM ? y + 1 : y, endM, endD ?? lastDay(y, endM)) };
}

const monthLabel = (m1: number, m2: number) => (m1 === m2 ? `${m1}月` : `${m1}月〜${m2}月`);

/**
 * 日程の手がかりを期間に直す（決まった言い方だけ）。
 * 対応：「2月」「2月か3月」「2〜3月」「2月から3月」「2月上旬/中旬/下旬/末」「春/夏/秋/冬」「年明け」「年内」「年末」「来月」「再来月」「今月」
 * 分からなければ今日から8週間。期間の始まりは今日より前にしない。
 */
export function hintToPeriod(hint: string | null | undefined, today: string): Period {
  const fallback: Period = { from: today, to: addDays(today, DEFAULT_WEEKS * 7 - 1), label: `今日から${DEFAULT_WEEKS}週間（時期の手がかりがないため）`, from_hint: false };
  if (!hint) return fallback;
  const h = hint.normalize("NFKC").replace(/\s+/g, "");
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  let r: { from: string; to: string; label: string } | null = null;

  // 「2月か3月」「2〜3月」「2月から3月」「2月・3月」
  const two = h.match(/(\d{1,2})月?(?:か|〜|~|-|から|・|、|or|または|もしくは)(\d{1,2})月/);
  const one = h.match(/(\d{1,2})月(上旬|初旬|はじめ|初め|中旬|下旬|末|終わり)?/);
  if (two && Number(two[1]) >= 1 && Number(two[1]) <= 12 && Number(two[2]) >= 1 && Number(two[2]) <= 12) {
    const [a, b] = [Number(two[1]), Number(two[2])];
    const p = place(today, a, 1, b, null);
    r = { ...p, label: monthLabel(a, b) };
  } else if (one && Number(one[1]) >= 1 && Number(one[1]) <= 12) {
    const m = Number(one[1]);
    const part = one[2] ? PART[one[2]] : null;
    const p = place(today, m, part ? part[0] : 1, m, part ? part[1] : null);
    r = { ...p, label: `${m}月${one[2] ?? ""}` };
  } else if (/年明け|年始|新年/.test(h)) {
    r = { ...place(today, 1, 1, 1, 31), label: "年明け（1月）" };
  } else if (/年末/.test(h)) {
    r = { ...place(today, 12, 1, 12, 28), label: "年末（12月）" };
  } else if (/年内/.test(h)) {
    r = { from: today, to: ymd(ty, 12, 28), label: "年内" };
  } else if (/再来月/.test(h)) {
    const m = ((tm + 1) % 12) + 1;
    r = { ...place(today, m, 1, m, null), label: `再来月（${m}月）` };
  } else if (/来月/.test(h)) {
    const m = (tm % 12) + 1;
    r = { ...place(today, m, 1, m, null), label: `来月（${m}月）` };
  } else if (/今月/.test(h)) {
    r = { from: today, to: ymd(ty, tm, lastDay(ty, tm)), label: `今月（${tm}月）` };
  } else {
    const s = h.match(/(春|夏|秋|冬)/);
    if (s) {
      const [a, b] = SEASON[s[1]];
      r = { ...place(today, a, 1, b, null), label: `${s[1]}（${monthLabel(a, b)}）` };
    }
  }
  if (!r || r.to < today) return fallback;
  return { from: r.from < today ? today : r.from, to: r.to, label: r.label, from_hint: true };
}

// ---------------------------------------------------------------------------
// 空いていそうな日
// ---------------------------------------------------------------------------
export type Suggestion =
  | { known: true; dates: string[]; note: string | null }
  | { known: false; dates: string[]; note: string };

const slotRange = (s: BusySlot): [number, number] => (s.all_day ? [dayMs(s.start), dayMs(s.end)] : [Date.parse(s.start), Date.parse(s.end)]);

/** 週（月曜はじまり）の番号 */
const weekKey = (date: string) => Math.floor((dayMs(date) - dayMs("2024-01-01")) / (7 * DAY));

/** 週をばらして最大 n 日を選ぶ。週ごとに最初の空いていそうな日を取り、週を均等に間引く。足りなければ残りから早い順に足す */
function spread(days: string[], n: number): string[] {
  const byWeek = new Map<number, string[]>();
  for (const d of days) byWeek.set(weekKey(d), [...(byWeek.get(weekKey(d)) ?? []), d]);
  const weeks = [...byWeek.keys()].sort((a, b) => a - b);
  const picked: string[] = [];
  if (weeks.length >= n) {
    for (let i = 0; i < n; i++) picked.push(byWeek.get(weeks[n === 1 ? 0 : Math.round((i * (weeks.length - 1)) / (n - 1))])![0]);
  } else {
    for (const w of weeks) picked.push(byWeek.get(w)![0]);
    for (const d of days) if (picked.length < n && !picked.includes(d)) picked.push(d);
  }
  return [...new Set(picked)].sort();
}

// ---------------------------------------------------------------------------
// 祝日と会社の休み（コードで持つ。外部のサイトや API には取りにいかない）
// ---------------------------------------------------------------------------
/**
 * 日本の祝日（振替休日・国民の休日を含む）。内閣府の「国民の祝日」の決まりどおりに並べた。
 * 年を足すときは、ここに1年分を足す（春分・秋分の日は前の年の2月に官報で決まる）。
 */
export const JP_HOLIDAYS: Record<number, Record<string, string>> = {
  2026: {
    "2026-01-01": "元日",
    "2026-01-12": "成人の日",
    "2026-02-11": "建国記念の日",
    "2026-02-23": "天皇誕生日",
    "2026-03-20": "春分の日",
    "2026-04-29": "昭和の日",
    "2026-05-03": "憲法記念日",
    "2026-05-04": "みどりの日",
    "2026-05-05": "こどもの日",
    "2026-05-06": "振替休日",
    "2026-07-20": "海の日",
    "2026-08-11": "山の日",
    "2026-09-21": "敬老の日",
    "2026-09-22": "国民の休日",
    "2026-09-23": "秋分の日",
    "2026-10-12": "スポーツの日",
    "2026-11-03": "文化の日",
    "2026-11-23": "勤労感謝の日",
  },
  2027: {
    "2027-01-01": "元日",
    "2027-01-11": "成人の日",
    "2027-02-11": "建国記念の日",
    "2027-02-23": "天皇誕生日",
    "2027-03-21": "春分の日",
    "2027-03-22": "振替休日",
    "2027-04-29": "昭和の日",
    "2027-05-03": "憲法記念日",
    "2027-05-04": "みどりの日",
    "2027-05-05": "こどもの日",
    "2027-07-19": "海の日",
    "2027-08-11": "山の日",
    "2027-09-20": "敬老の日",
    "2027-09-23": "秋分の日",
    "2027-10-11": "スポーツの日",
    "2027-11-03": "文化の日",
    "2027-11-23": "勤労感謝の日",
  },
};

/** 祝日の名前（祝日でなければ null） */
export const holidayName = (date: string): string | null => JP_HOLIDAYS[Number(date.slice(0, 4))]?.[date] ?? null;

/** 年末年始（12/29〜1/3）を会社の休みとして除くか。.env の DATE_SUGGEST_YEAR_END_OFF=off で除かない（既定は除く） */
export function yearEndOff(): boolean {
  return (process.env.DATE_SUGGEST_YEAR_END_OFF ?? "").trim().toLowerCase() !== "off";
}
export const isYearEnd = (date: string) => {
  const md = date.slice(5);
  return md >= "12-29" || md <= "01-03";
};

/** その日を「平日」として扱わない理由（週末・祝日・年末年始）。平日なら null */
export function dayOffReason(date: string, opts: { yearEnd?: boolean } = {}): string | null {
  const w = dow(date);
  if (w === 0 || w === 6) return "週末";
  const h = holidayName(date);
  if (h) return h;
  if ((opts.yearEnd ?? yearEndOff()) && isYearEnd(date)) return "年末年始の休み";
  return null;
}

/**
 * 期間の中から、平日の指定の時間帯に予定がなく、終日の予定もない日を最大3日選ぶ。
 * 平日から、日本の祝日（振替休日を含む）と年末年始（12/29〜1/3、設定で外せる）を除く。祝日の一覧がない年は、その旨を補足に書く。
 * slots が null（カレンダーがない）なら「予定は不明」。knownUntil より先の日は、予定が分からないので選ばない。
 */
export function suggestDates(
  slots: BusySlot[] | null,
  period: Pick<Period, "from" | "to">,
  opts: { knownUntil?: string | null; hours?: { start: number; end: number }; max?: number; yearEnd?: boolean } = {},
): Suggestion {
  if (!slots) return { known: false, dates: [], note: "予定は不明（カレンダーがないため、空いていそうな日は出していません）" };
  const hours = opts.hours ?? suggestHours();
  const max = opts.max ?? MAX_SUGGESTIONS;
  const until = opts.knownUntil && opts.knownUntil < period.to ? opts.knownUntil : period.to;
  if (until < period.from) {
    return { known: true, dates: [], note: `予定が分かるのは ${opts.knownUntil} までで、この時期（${period.from}〜${period.to}）の予定はまだ分かりません` };
  }
  const ranges = slots.map(slotRange).filter(([a, b]) => b > a);
  const yearEnd = opts.yearEnd ?? yearEndOff();
  const free: string[] = [];
  const noHolidayYears = new Set<number>();
  for (let d = period.from; d <= until; d = addDays(d, 1)) {
    if (!JP_HOLIDAYS[Number(d.slice(0, 4))]) noHolidayYears.add(Number(d.slice(0, 4)));
    if (dayOffReason(d, { yearEnd })) continue; // 週末・祝日・年末年始は出さない
    const start = dayMs(d);
    const allDay = slots.some((s) => s.all_day && dayMs(s.start) <= start && start < dayMs(s.end));
    if (allDay) continue;
    const a = start + hours.start * 3600_000;
    const b = start + hours.end * 3600_000;
    if (ranges.some(([x, y]) => x < b && y > a)) continue;
    free.push(d);
  }
  const dates = spread(free, max);
  const extra = [
    until < period.to ? `予定が分かるのは ${until} までなので、その先は見ていません` : "",
    noHolidayYears.size ? `${[...noHolidayYears].sort().join("・")}年の祝日は一覧にないので、祝日を除いていません` : "",
  ].filter(Boolean);
  const cut = extra.join("。");
  if (!dates.length) return { known: true, dates: [], note: `この時期の平日${hours.start}〜${hours.end}時は、空いていそうな日が見つかりませんでした${cut ? `（${cut}）` : ""}` };
  return { known: true, dates, note: cut || null };
}

/** 主催者への返事に入れてよい1文の材料（入れるかどうかは技術広報が選ぶ）。予定の中身や埋まり具合は書かない */
export function replySentence(dates: string[]): string | null {
  if (!dates.length) return null;
  return `${dates.map(dateLabel).join("・")}あたりなら調整しやすそうです（本人に確認します）。`;
}

// ---------------------------------------------------------------------------
// 会話の中の日付を読む（コード。lib/intake.ts の日程の確かめから使う想定）
//   読める形：2026-12-15・2026/12/15・2026.12.15(火)・2026年12月15日・12/15・12月15日・全角の数字、
//             英語の月名（February 18, 2027・Feb. 18・18 February 2027）、
//             「12月15日、16日」「12月15日と16日」「12/15・16」（2つ目は月を省いた日。2つの日付として数える）、
//             「12/15〜16」「12月15日〜17日」（期間。1日には決めない）
//   暦にない日付（2月30日・4月31日など）は「読めたが日付ではない」として返し、日程には決めない
// ---------------------------------------------------------------------------
export interface DateInText {
  /** 会話の中の書き方そのまま */
  text: string;
  /** 正規化（NFKC）した文の中の位置 */
  index: number;
  /** 書かれていた年（なければ null） */
  year: number | null;
  month: number;
  day: number;
  /** 暦にある日付か（2月30日などは false） */
  valid: boolean;
  /** 期間（〜）の一部か */
  in_range: boolean;
}

const EN_MONTH: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const EN_MONTHS = Object.keys(EN_MONTH).sort((a, b) => b.length - a.length).join("|");

/** 年・月・日が暦にあるか（年がなければ、うるう年も含めて2月29日までを認める） */
function onCalendar(y: number | null, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= lastDay(y ?? 2028, m);
}

const NUM_DATE = /(?:(\d{4})\s*[-/.年]\s*)?(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/g;
const EN_MD = new RegExp(String.raw`\b(${EN_MONTHS})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`, "gi");
const EN_DM = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(${EN_MONTHS})\.?(?:,?\s+(\d{4}))?\b`, "gi");
/** 日付のすぐあとの「、16日」「と16日」「・16」（月を省いた2つ目の日） */
//   2つ目の日は「日」で終わるか、すぐあとが区切り・文の終わりのときだけ（「12/15、19時から」「12/15、20名」の 19・20 は日付にしない）
const MORE_DAY = /^\s*(?:[、,・]|と|か|または|又は|および|及び|or|and)\s*(\d{1,2})(?:\s*日|(?=\s*(?:[(（)）、,。・]|$|と|か|または|or\b|and\b)))/i;
/** 日付のすぐあとの「〜16日」「~12/17」（期間の終わり） */
const RANGE_TO = /^\s*[〜~～\-–]\s*(?:(\d{4})\s*[-/.年]\s*)?(?:(\d{1,2})\s*[-/.月]\s*)?(\d{1,2})(?:\s*日|(?![\d:：時分名人件]))/;

/** 会話（または引用）の中の日付をすべて読む。重なる読み方は先に見つけたものを使う */
export function datesInText(raw: string): DateInText[] {
  const text = raw.normalize("NFKC");
  const found: DateInText[] = [];
  const taken: Array<[number, number]> = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  const add = (t: string, index: number, year: number | null, month: number, day: number, inRange = false) => {
    found.push({ text: t, index, year, month, day, valid: onCalendar(year, month, day), in_range: inRange });
  };
  const follow = (end: number, year: number | null, month: number) => {
    // 月を省いた2つ目の日（「、16日」）と、期間の終わり（「〜16日」）
    let rest = text.slice(end);
    const more = rest.match(MORE_DAY);
    if (more) {
      add(more[0].trim(), end + (more.index ?? 0), year, month, Number(more[1]));
      taken.push([end, end + more[0].length]);
      return true;
    }
    const to = rest.match(RANGE_TO);
    if (to) {
      add(to[0].trim(), end, to[1] ? Number(to[1]) : year, to[2] ? Number(to[2]) : month, Number(to[3]), true);
      taken.push([end, end + to[0].length]);
      return true;
    }
    return false;
  };

  // 英語の月名（数字の読み方より先。「Feb 18, 2027」の 18, 2027 を数字の日付と読まないように）
  for (const re of [EN_MD, EN_DM]) {
    for (const m of text.matchAll(re)) {
      const i = m.index ?? 0;
      if (!free(i, i + m[0].length)) continue;
      const md = re === EN_MD;
      const month = EN_MONTH[(md ? m[1] : m[2]).toLowerCase().replace(/\.$/, "")];
      const day = Number(md ? m[2] : m[1]);
      taken.push([i, i + m[0].length]);
      const year = m[3] ? Number(m[3]) : null;
      add(m[0], i, year, month, day, RANGE_TO.test(text.slice(i + m[0].length)));
      follow(i + m[0].length, year, month);
    }
  }
  for (const m of text.matchAll(NUM_DATE)) {
    const i = m.index ?? 0;
    if (!free(i, i + m[0].length)) continue;
    const year = m[1] ? Number(m[1]) : null;
    // ピリオド区切りは年があるときだけ日付とみなす（「1.5倍」「v2.3」などを読まない）
    if (!year && /^\d{1,2}\s*\.\s*\d/.test(m[0])) continue;
    // 「1-2人」「3-4件」のようなハイフンの数の幅は、年がなければ読まない
    if (!year && /^\d{1,2}\s*-\s*\d/.test(m[0])) continue;
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12) continue;
    taken.push([i, i + m[0].length]);
    const inRange = RANGE_TO.test(text.slice(i + m[0].length));
    add(m[0], i, year, month, day, inRange);
    follow(i + m[0].length, year, month);
  }
  return found.sort((a, b) => a.index - b.index);
}

/** 年が書かれていない日付に年を付ける。受信日の30日前より前になるなら翌年（lib/intake.ts の checkDate と同じ決め方） */
export function withYear(d: Pick<DateInText, "year" | "month" | "day">, receivedAt: string): string {
  if (d.year) return ymd(d.year, d.month, d.day);
  const received = receivedAt.slice(0, 10);
  const y = Number(received.slice(0, 4));
  const limit = addDays(received, -30);
  const same = ymd(y, d.month, d.day);
  return same < limit ? ymd(y + 1, d.month, d.day) : same;
}

/**
 * 引用（会話の一節）から、日程をちょうど1日に決められるか。決められなければ date は null で、理由を返す。
 * - 日付がない・2つ以上ある（「12月15日、16日」も2つ）・期間（〜）・暦にない（2月30日）なら決めない
 * - 「候補」「未定」などの言い回しの判定は、呼ぶ側（lib/intake.ts の NOT_FIXED）が続けて行う
 */
export function decideDate(quote: string, receivedAt: string): { date: string | null; reason: string | null } {
  const ds = datesInText(quote);
  const head = quote.slice(0, 30);
  if (ds.length === 0) return { date: null, reason: `「${head}」からは日付が1日に決まりません` };
  const bad = ds.find((d) => !d.valid);
  if (bad) return { date: null, reason: `「${bad.text}」は暦にない日付なので、日程に決めません` };
  if (ds.length > 1 || ds[0].in_range) return { date: null, reason: `日程は「${head}」で、まだ1日に決まっていません` };
  return { date: withYear(ds[0], receivedAt), reason: null };
}

/**
 * 会話（NFKC 済み）の中で引用の位置を探す。NFKC にそろえ、空白（改行を含む）の違いは無視する
 * （lib/intake.ts の読み取りの照合と同じ決め方）。見つかれば会話の中の [at, end)、なければ at = -1
 */
export function findQuote(normText: string, quote: string): { at: number; end: number } {
  const q = quote.normalize("NFKC").replace(/\s+/g, "");
  if (!q) return { at: -1, end: -1 };
  // 空白を除いた会話と、その1文字ずつが元の会話のどこにあったか
  let compact = "";
  const pos: number[] = [];
  for (let i = 0; i < normText.length; i++) {
    if (/\s/.test(normText[i])) continue;
    compact += normText[i];
    pos.push(i);
  }
  const c = compact.indexOf(q);
  if (c < 0) return { at: -1, end: -1 };
  return { at: pos[c], end: pos[c + q.length - 1] + 1 };
}

/**
 * 会話全体の中にある、決めた日付とは別の日付（暦にあるものだけ。年を付けた形）。
 * 引用の前にあるか後にあるか（before_quote）も返す。会話のあとのほうで日程が変わることがあるので、どう扱うかは呼ぶ側が決める。
 * 例：「開催は 2026.12.15(火) です。※チラシには12/16（水）と…」で 2026-12-15 を決めたら、12/16 を返す
 */
export function otherDatesInConversation(
  text: string,
  quote: string,
  decided: string,
  receivedAt: string,
): Array<{ date: string; text: string; before_quote: boolean }> {
  const norm = text.normalize("NFKC");
  const { at: qAt, end: qEnd } = findQuote(norm, quote);
  const out: Array<{ date: string; text: string; before_quote: boolean }> = [];
  const seen = new Set<string>();
  for (const d of datesInText(norm)) {
    if (!d.valid) continue;
    const date = withYear(d, receivedAt);
    if (date === decided || seen.has(date)) continue;
    // 引用の中の日付は、引用そのものの判定（decideDate）で扱うので、ここでは外の日付だけ
    if (qAt >= 0 && d.index >= qAt && d.index < qEnd) continue;
    seen.add(date);
    out.push({ date, text: d.text, before_quote: qAt >= 0 ? d.index < qAt : false });
  }
  return out;
}
