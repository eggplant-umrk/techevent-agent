// iCal（.ics）から「いつ埋まっているか」だけを読む。
// 読むのは DTSTART・DTEND・DURATION・RRULE・EXDATE・RECURRENCE-ID・UID・STATUS・TRANSP だけ。
// 予定のタイトル（SUMMARY）・場所（LOCATION）・参加者（ATTENDEE・ORGANIZER）・説明は読まない（取り出さない・保存しない）。
// UID は「繰り返しのどの回が変更されたか」を突き合わせるためだけに使い、外には出さない。
//
// 対応している範囲（足りない分は「埋まっていない」側に倒れる）
// - 時刻：UTC（…Z）、TZID 付き（Asia/Tokyo など IANA の名前。Windows の「Tokyo Standard Time」も日本時間として読む）、
//         タイムゾーンなし（日本時間として読む）、終日（VALUE=DATE）
// - 繰り返し：FREQ=DAILY / WEEKLY（INTERVAL・COUNT・UNTIL・BYDAY に複数の曜日、WKST）。曜日と時刻はその予定のタイムゾーンの壁時計で数える
// - EXDATE で除いた回は数えない。RECURRENCE-ID で変更された回は、元の回の代わりに変更後の時間を数える
// - STATUS:CANCELLED と TRANSP:TRANSPARENT（「空き」として表示する予定）は数えない

/** 埋まっている時間帯。all_day のとき start・end は日付（end は含まない：ics と同じ）。それ以外は日時（ISO、+09:00 など）。 */
export interface BusySlot {
  start: string;
  end: string;
  all_day: boolean;
}

const JST = 9 * 3600_000;
const DAY = 86_400_000;
const DEFAULT_TZ = "Asia/Tokyo";

/** 折り返された行（次の行が空白で始まる）をつなげる。 */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""));
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
    if (eq > 0) p[kv.slice(0, eq).toUpperCase()] = kv.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return [name.toUpperCase(), { params: p, value: line.slice(colon + 1).trim() }];
}

// ---- タイムゾーン ---------------------------------------------------------------------

/** Windows の名前など、IANA でない書き方を直す（よく出るものだけ）。分からなければ日本時間 */
const TZ_ALIAS: Record<string, string> = {
  "Tokyo Standard Time": "Asia/Tokyo",
  JST: "Asia/Tokyo",
  "Japan": "Asia/Tokyo",
  UTC: "UTC",
  GMT: "UTC",
  "Coordinated Universal Time": "UTC",
};
const tzOk = new Map<string, string>();
function normalizeTz(tz: string | undefined): string {
  if (!tz) return DEFAULT_TZ;
  const hit = tzOk.get(tz);
  if (hit) return hit;
  let name = TZ_ALIAS[tz] ?? tz.replace(/^\/[^/]+\/[^/]+\//, ""); // "/mozilla.org/20050126_1/Asia/Tokyo" のような前置き
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
  } catch {
    name = DEFAULT_TZ;
  }
  tzOk.set(tz, name);
  return name;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** その時刻での、タイムゾーンの UTC からのずれ（ms） */
function tzOffset(ms: number, tz: string): number {
  if (tz === "Asia/Tokyo") return JST;
  if (tz === "UTC") return 0;
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** 壁時計（UTC として表した値）→ 実際の時刻 */
function fromWall(wall: number, tz: string): number {
  let ms = wall - tzOffset(wall, tz);
  ms = wall - tzOffset(ms, tz); // 夏時間の境目を1回だけ直す
  return ms;
}
/** 実際の時刻 → 壁時計（UTC として表した値） */
const toWall = (ms: number, tz: string) => ms + tzOffset(ms, tz);

// ---- 日付・日時 -------------------------------------------------------------------------

interface Time {
  /** 実際の時刻（epoch ms） */
  ms: number;
  allDay: boolean;
  /** 曜日・繰り返しを数えるタイムゾーン */
  tz: string;
}

/** ics の日付・日時 → 実際の時刻と終日かどうか。 */
function parseTime(prop: Prop): Time | null {
  const v = prop.value;
  if (/^\d{8}$/.test(v) || prop.params.VALUE === "DATE") {
    const m = v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3]) - JST, allDay: true, tz: DEFAULT_TZ };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  if (m[7]) return { ms: wall, allDay: false, tz: DEFAULT_TZ }; // UTC。曜日は日本時間で数える
  const tz = normalizeTz(prop.params.TZID);
  return { ms: fromWall(wall, tz), allDay: false, tz };
}

function parseDuration(v: string): number | null {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+(w ?? 0) * 7 + +(d ?? 0)) * 86_400 + +(h ?? 0) * 3600 + +(mi ?? 0) * 60 + +(s ?? 0)) * 1000;
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

// ---- 読み取り -----------------------------------------------------------------------------

type RawEvent = Record<string, Prop[]>;
const KEEP = ["DTSTART", "DTEND", "DURATION", "RRULE", "EXDATE", "STATUS", "TRANSP", "RECURRENCE-ID", "UID"];

function readEvents(text: string): RawEvent[] {
  const out: RawEvent[] = [];
  let ev: RawEvent | null = null;
  let depth = 0; // VEVENT の中の VALARM などは読まない
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      ev = {};
      depth = 0;
      continue;
    }
    if (line === "END:VEVENT") {
      if (ev) out.push(ev);
      ev = null;
      continue;
    }
    if (!ev) continue;
    if (line.startsWith("BEGIN:")) depth++;
    else if (line.startsWith("END:")) depth = Math.max(0, depth - 1);
    if (depth > 0) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const [name, prop] = parsed;
    // 時間を決める項目だけを残す（SUMMARY・LOCATION・ATTENDEE などは捨てる）
    if (KEEP.includes(name)) (ev[name] ??= []).push(prop);
  }
  return out;
}

/**
 * .ics の本文から、埋まっている時間帯を返す。繰り返しは [rangeFrom, rangeTo) に入る回だけ展開する。
 * タイトル・場所・参加者は読まない。
 */
export function parseIcs(text: string, rangeFrom: Date, rangeTo: Date): BusySlot[] {
  const events = readEvents(text);
  // 変更された回（RECURRENCE-ID）：元の繰り返しからその回を除き、変更後の予定を1回として数える
  const moved = new Map<string, Set<number>>();
  for (const ev of events) {
    const uid = ev.UID?.[0]?.value;
    const rid = ev["RECURRENCE-ID"]?.[0] ? parseTime(ev["RECURRENCE-ID"][0]) : null;
    if (uid && rid) (moved.get(uid) ?? moved.set(uid, new Set()).get(uid)!).add(rid.ms);
  }
  const out: BusySlot[] = [];
  for (const ev of events) {
    const isOverride = !!ev["RECURRENCE-ID"]?.[0];
    const skip = isOverride ? undefined : moved.get(ev.UID?.[0]?.value ?? "");
    out.push(...expand(ev, rangeFrom.getTime(), rangeTo.getTime(), skip));
  }
  return out;
}

function expand(ev: RawEvent, from: number, to: number, skip?: Set<number>): BusySlot[] {
  if (ev.STATUS?.[0]?.value.toUpperCase() === "CANCELLED") return [];
  if (ev.TRANSP?.[0]?.value.toUpperCase() === "TRANSPARENT") return [];
  const start = ev.DTSTART?.[0] ? parseTime(ev.DTSTART[0]) : null;
  if (!start) return [];
  let length: number;
  const end = ev.DTEND?.[0] ? parseTime(ev.DTEND[0]) : null;
  if (end) length = end.ms - start.ms;
  else if (ev.DURATION?.[0]) length = parseDuration(ev.DURATION[0].value) ?? 0;
  else length = start.allDay ? DAY : 0;
  if (length <= 0) return [];

  const excluded = new Set<number>(skip ?? []);
  for (const p of ev.EXDATE ?? [])
    for (const v of p.value.split(",")) {
      const t = parseTime({ params: p.params, value: v.trim() });
      if (t) excluded.add(t.ms);
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
    const freq = r.FREQ?.toUpperCase();
    if (freq !== "DAILY" && freq !== "WEEKLY") starts.push(start.ms); // ほかの繰り返しは初回だけ数える
    else {
      const interval = Math.max(1, Number(r.INTERVAL ?? 1) || 1);
      const count = r.COUNT ? Number(r.COUNT) : Infinity;
      const until = r.UNTIL ? (parseTime({ params: start.allDay ? { VALUE: "DATE" } : {}, value: r.UNTIL })?.ms ?? Infinity) : Infinity;
      // 曜日・週・時刻は、その予定のタイムゾーンの壁時計で数える（UTC を足し引きしない）
      const tz = start.tz;
      const startWall = start.allDay ? start.ms + JST : toWall(start.ms, tz);
      const dayOfWall = (w: number) => new Date(w).getUTCDay();
      const startDow = dayOfWall(startWall);
      const wkst = DAY_CODES.indexOf((r.WKST ?? "MO").toUpperCase());
      const weekStartOffset = (startDow - (wkst < 0 ? 1 : wkst) + 7) % 7; // 週の始まりから何日目か
      const byday =
        freq === "WEEKLY" && r.BYDAY
          ? r.BYDAY.split(",")
              .map((d) => DAY_CODES.indexOf(d.trim().slice(-2).toUpperCase()))
              .filter((d) => d >= 0)
          : [startDow];
      let n = 0;
      // 1日ずつ（壁時計で）進めて、規則に合う日を拾う（期間の終わりか回数・UNTIL で止める）
      for (let day = 0; n < count; day++) {
        const wall = startWall + day * DAY;
        const t = start.allDay ? wall - JST : fromWall(wall, tz);
        if (t > until || t >= to) break;
        const ok =
          freq === "DAILY"
            ? day % interval === 0
            : byday.includes(dayOfWall(wall)) && Math.floor((day + weekStartOffset) / 7) % interval === 0;
        if (!ok) continue;
        n++; // COUNT は期間の前の回も数える
        starts.push(t);
      }
    }
  }

  return starts
    .filter((s) => !excluded.has(s) && s < to && s + length > from)
    .map((s) =>
      start.allDay
        ? { start: dateJst(s), end: dateJst(s + length), all_day: true }
        : { start: isoJst(s), end: isoJst(s + length), all_day: false },
    );
}

/** 本文が iCal か（HTML のエラーページなどを見分ける） */
export function looksLikeIcs(text: string): boolean {
  return /BEGIN:VCALENDAR/.test(text.slice(0, 2000));
}

/** 調べる用：.ics の形の件数だけを数える（タイトル・場所・参加者・URL は見ない）。 */
export function icsStats(text: string) {
  const s = { events: 0, rrule: 0, weekly: 0, multiByday: 0, interval: 0, until: 0, count: 0, utc: 0, tzid: 0, allDay: 0, otherTime: 0, recurrenceId: 0, exdate: 0, tzids: [] as string[] };
  const tz = new Set<string>();
  for (const ev of readEvents(text)) {
    s.events++;
    const rr = ev.RRULE?.[0]?.value;
    if (rr) {
      s.rrule++;
      if (/FREQ=WEEKLY/i.test(rr)) s.weekly++;
      if (/BYDAY=[^;]*,/i.test(rr)) s.multiByday++;
      if (/INTERVAL=([2-9]|\d{2,})/i.test(rr)) s.interval++;
      if (/UNTIL=/i.test(rr)) s.until++;
      if (/COUNT=/i.test(rr)) s.count++;
    }
    if (ev["RECURRENCE-ID"]) s.recurrenceId++;
    if (ev.EXDATE) s.exdate++;
    const st = ev.DTSTART?.[0];
    if (st) {
      if (st.params.TZID) (s.tzid++, tz.add(st.params.TZID));
      else if (st.params.VALUE === "DATE" || /^\d{8}$/.test(st.value)) s.allDay++;
      else if (/Z$/.test(st.value)) s.utc++;
      else s.otherTime++;
    }
  }
  s.tzids = [...tz];
  return s;
}
