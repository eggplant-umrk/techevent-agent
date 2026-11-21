// Date consistency for proposal text (cautions / caveat).
// A date that is presented as the event day ("開催日 X", "当日 X", "X の前後3日") must match this
// request's event date, and no date may be another request's event day unless it is also this one's.
// Other dates (last talk, a schedule range like 1/27〜1/29) are allowed.

export interface DateMention {
  text: string;
  index: number;
  start: { m: number; d: number };
  end: { m: number; d: number };
}

// 2027-01-28 / 2027/1/28 / 1/28 / 1月28日, optionally followed by 〜 / ~ / - and an end (full date, M/D, or day)
const DATE = String.raw`(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})日?`;
const RANGE_END = String.raw`(?:\s*[〜~～\-]\s*(?:(?:\d{4})[-/年])?(?:(\d{1,2})[-/月])?(\d{1,2})日?)?`;
const RE = new RegExp(DATE + RANGE_END, "g");

export function findDates(text: string): DateMention[] {
  const out: DateMention[] = [];
  for (const m of text.matchAll(RE)) {
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    // Skip things like "1/3" in "1/3の時間" only when they are clearly not dates: keep it simple,
    // a bare M/D with no year is still treated as a date (that is how the agent writes them).
    const endMonth = m[4] ? Number(m[4]) : month;
    const endDay = m[5] ? Number(m[5]) : day;
    out.push({ text: m[0], index: m.index ?? 0, start: { m: month, d: day }, end: { m: endMonth, d: endDay } });
  }
  return out;
}

const md = (iso: string) => ({ m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
const key = (x: { m: number; d: number }) => x.m * 100 + x.d;
const covers = (x: DateMention, day: { m: number; d: number }) => key(x.start) <= key(day) && key(day) <= key(x.end);

/** Phrases that present a date as the event day. */
const EVENT_BEFORE = /(開催日?|当日|イベント日|登壇日)[はのが：: ]*$/;
const EVENT_AFTER = /^[はのが]?\s*(前後\s*\d+\s*日|当日|開催)/;

/**
 * Returns problems with the dates in `text` for a request held on `eventDate` (YYYY-MM-DD).
 * `otherEventDates` are the event days of the other requests (to catch text copied across requests).
 */
export function dateProblems(text: string, eventDate: string | undefined, otherEventDates: string[]): string[] {
  if (!text || !eventDate || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return [];
  const ev = md(eventDate);
  const others = otherEventDates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== eventDate).map(md);
  const problems: string[] = [];
  for (const x of findDates(text)) {
    const before = text.slice(Math.max(0, x.index - 12), x.index);
    const after = text.slice(x.index + x.text.length, x.index + x.text.length + 10);
    const asEventDay = EVENT_BEFORE.test(before) || EVENT_AFTER.test(after);
    if (asEventDay && !covers(x, ev)) {
      problems.push(`「${x.text}」を開催日として書いていますが、この依頼の開催日は ${eventDate} です`);
      continue;
    }
    const single = key(x.start) === key(x.end);
    if (single && others.some((o) => key(o) === key(x.start)) && key(x.start) !== key(ev)) {
      problems.push(`「${x.text}」は別の依頼の開催日です（この依頼の開催日は ${eventDate}）`);
    }
  }
  return problems;
}
