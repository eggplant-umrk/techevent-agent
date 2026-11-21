// 日程が決まっていない依頼（「2月か3月」「春ごろ」など）で、候補の人の「空いていそうな日」を出す（AI は使わない）。
// - 日程の手がかり（会話にある言い回しそのまま）を、決まった言い方だけ期間に直す。分からなければ今日から8週間
// - 期間の中から、平日の夜（既定 19〜21時。設定で変えられる）に予定がなく、終日の予定もない日を最大3日。なるべく週をばらす
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

/**
 * 期間の中から、平日の指定の時間帯に予定がなく、終日の予定もない日を最大3日選ぶ。
 * slots が null（カレンダーがない）なら「予定は不明」。knownUntil より先の日は、予定が分からないので選ばない。
 */
export function suggestDates(
  slots: BusySlot[] | null,
  period: Pick<Period, "from" | "to">,
  opts: { knownUntil?: string | null; hours?: { start: number; end: number }; max?: number } = {},
): Suggestion {
  if (!slots) return { known: false, dates: [], note: "予定は不明（カレンダーがないため、空いていそうな日は出していません）" };
  const hours = opts.hours ?? suggestHours();
  const max = opts.max ?? MAX_SUGGESTIONS;
  const until = opts.knownUntil && opts.knownUntil < period.to ? opts.knownUntil : period.to;
  if (until < period.from) {
    return { known: true, dates: [], note: `予定が分かるのは ${opts.knownUntil} までで、この時期（${period.from}〜${period.to}）の予定はまだ分かりません` };
  }
  const ranges = slots.map(slotRange).filter(([a, b]) => b > a);
  const free: string[] = [];
  for (let d = period.from; d <= until; d = addDays(d, 1)) {
    const w = dow(d);
    if (w === 0 || w === 6) continue; // 週末は出さない
    const start = dayMs(d);
    const allDay = slots.some((s) => s.all_day && dayMs(s.start) <= start && start < dayMs(s.end));
    if (allDay) continue;
    const a = start + hours.start * 3600_000;
    const b = start + hours.end * 3600_000;
    if (ranges.some(([x, y]) => x < b && y > a)) continue;
    free.push(d);
  }
  const dates = spread(free, max);
  const cut = until < period.to ? `予定が分かるのは ${until} までなので、その先は見ていません` : "";
  if (!dates.length) return { known: true, dates: [], note: `この時期の平日${hours.start}〜${hours.end}時は、空いていそうな日が見つかりませんでした${cut ? `（${cut}）` : ""}` };
  return { known: true, dates, note: cut || null };
}

/** 主催者への返事に入れてよい1文の材料（入れるかどうかは技術広報が選ぶ）。予定の中身や埋まり具合は書かない */
export function replySentence(dates: string[]): string | null {
  if (!dates.length) return null;
  return `${dates.map(dateLabel).join("・")}あたりなら調整しやすそうです（本人に確認します）。`;
}
