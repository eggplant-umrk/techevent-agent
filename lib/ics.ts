// iCal（.ics）から「いつ埋まっているか」だけを読む。
// 読むのは DTSTART・DTEND・DURATION・RRULE・EXDATE・STATUS・TRANSP だけ。
// 予定のタイトル（SUMMARY）・場所（LOCATION）・参加者（ATTENDEE・ORGANIZER）・説明は読まない（取り出さない・保存しない）。
//
// 対応している範囲（足りない分は「埋まっていない」側に倒れる）
// - 時刻：UTC（…Z）、TZID 付き・タイムゾーンなし（どちらも日本時間として読む）、終日（VALUE=DATE）
// - 繰り返し：FREQ=DAILY / WEEKLY（INTERVAL・COUNT・UNTIL・BYDAY）。EXDATE で除いた回は数えない
// - STATUS:CANCELLED と TRANSP:TRANSPARENT（「空き」として表示する予定）は数えない

/** 埋まっている時間帯。all_day のとき start・end は日付（end は含まない：ics と同じ）。それ以外は日時（ISO、+09:00 など）。 */
export interface BusySlot {
  start: string;
  end: string;
  all_day: boolean;
}

const JST = 9 * 3600_000;

/** 折り返された行（次の行が空白で始まる）をつなげる。 */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

interface Prop {
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): [string, Prop] | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const [name, ...params] = line.slice(0, colon).split(";");
  const p: Record<string, string> = {};
  for (const kv of params) {
    const eq = kv.indexOf("=");
    if (eq > 0) p[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1);
  }
  return [
    name.toUpperCase(),
    { params: p, value: line.slice(colon + 1).trim() },
  ];
}

/** ics の日付・日時 → epoch ms と終日かどうか。 */
function parseTime(prop: Prop): { ms: number; allDay: boolean } | null {
  const v = prop.value;
  const date = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (date || prop.params.VALUE === "DATE") {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3]) - JST, allDay: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return { ms: m[7] ? utc : utc - JST, allDay: false };
}

function parseDuration(v: string): number | null {
  const m = v.match(
    /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms =
    ((+(w ?? 0) * 7 + +(d ?? 0)) * 86_400 +
      +(h ?? 0) * 3600 +
      +(mi ?? 0) * 60 +
      +(s ?? 0)) *
    1000;
  return sign === "-" ? -ms : ms;
}

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** 日本時間の ISO 文字列。 */
function isoJst(ms: number): string {
  return new Date(ms + JST).toISOString().slice(0, 19) + "+09:00";
}
function dateJst(ms: number): string {
  return new Date(ms + JST).toISOString().slice(0, 10);
}

/**
 * .ics の本文から、埋まっている時間帯を返す。繰り返しは [rangeFrom, rangeTo) に入る回だけ展開する。
 * タイトル・場所・参加者は読まない。
 */
export function parseIcs(
  text: string,
  rangeFrom: Date,
  rangeTo: Date,
): BusySlot[] {
  const out: BusySlot[] = [];
  let ev: Record<string, Prop[]> | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      ev = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (ev) out.push(...expand(ev, rangeFrom.getTime(), rangeTo.getTime()));
      ev = null;
      continue;
    }
    if (!ev) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const [name, prop] = parsed;
    // 時間を決める項目だけを残す（SUMMARY・LOCATION・ATTENDEE などは捨てる）
    if (
      [
        "DTSTART",
        "DTEND",
        "DURATION",
        "RRULE",
        "EXDATE",
        "STATUS",
        "TRANSP",
      ].includes(name)
    )
      (ev[name] ??= []).push(prop);
  }
  return out;
}

function expand(
  ev: Record<string, Prop[]>,
  from: number,
  to: number,
): BusySlot[] {
  if (ev.STATUS?.[0]?.value.toUpperCase() === "CANCELLED") return [];
  if (ev.TRANSP?.[0]?.value.toUpperCase() === "TRANSPARENT") return [];
  const start = ev.DTSTART?.[0] ? parseTime(ev.DTSTART[0]) : null;
  if (!start) return [];
  let length: number;
  const end = ev.DTEND?.[0] ? parseTime(ev.DTEND[0]) : null;
  if (end) length = end.ms - start.ms;
  else if (ev.DURATION?.[0]) length = parseDuration(ev.DURATION[0].value) ?? 0;
  else length = start.allDay ? 86_400_000 : 0;
  if (length <= 0) return [];

  const exdates = new Set<number>();
  for (const p of ev.EXDATE ?? [])
    for (const v of p.value.split(",")) {
      const t = parseTime({ params: p.params, value: v });
      if (t) exdates.add(t.ms);
    }

  const starts: number[] = [];
  const rule = ev.RRULE?.[0]?.value;
  if (!rule) starts.push(start.ms);
  else {
    const r: Record<string, string> = {};
    for (const kv of rule.split(";")) {
      const [k, v] = kv.split("=");
      if (k && v) r[k.toUpperCase()] = v;
    }
    const freq = r.FREQ;
    if (freq !== "DAILY" && freq !== "WEEKLY")
      starts.push(start.ms); // ほかの繰り返しは初回だけ数える
    else {
      const interval = Math.max(1, Number(r.INTERVAL ?? 1));
      const count = r.COUNT ? Number(r.COUNT) : Infinity;
      const until = r.UNTIL
        ? (parseTime({ params: {}, value: r.UNTIL })?.ms ?? Infinity)
        : Infinity;
      const startDow = new Date(start.ms + JST).getUTCDay();
      const byday =
        freq === "WEEKLY" && r.BYDAY
          ? r.BYDAY.split(",")
              .map((d) => DAY_CODES.indexOf(d.slice(-2)))
              .filter((d) => d >= 0)
          : [startDow];
      let n = 0;
      // 1日ずつ進めて、規則に合う日を拾う（期間の終わりか回数・UNTIL で止める）
      for (let day = 0; n < count; day++) {
        const t = start.ms + day * 86_400_000;
        if (t > until || t >= to) break;
        const dow = new Date(t + JST).getUTCDay();
        const ok =
          freq === "DAILY"
            ? day % interval === 0
            : byday.includes(dow) &&
              Math.floor((day + ((startDow + 6) % 7)) / 7) % interval === 0;
        if (!ok) continue;
        n++;
        starts.push(t);
      }
    }
  }

  return starts
    .filter((s) => !exdates.has(s) && s < to && s + length > from)
    .map((s) =>
      start.allDay
        ? { start: dateJst(s), end: dateJst(s + length), all_day: true }
        : { start: isoJst(s), end: isoJst(s + length), all_day: false },
    );
}
