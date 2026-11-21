// 忙しさを予定から計算する（AIは使わない）。
//   「今後2週間の平日・勤務時間（10〜19時）のうち、予定で埋まっている割合」と区分、期間内の予定の一覧を返す。
//   予定の一覧は開始・終了・終日かどうかだけ（タイトル・場所・参加者は持たない）。
//
// 予定の出どころ
//   - 架空データ（既定）：data/calendar.json（時間単位の予定）＋ data/schedules.json（出張・休暇などの終日の予定）
//   - DATA_SOURCE=github（本人）・DEMO_PERSON=on の31人目（本人）：CALENDAR_ICS_URL があればその iCal、なければ「予定は不明」（推測の数字は入れない）
//
// 画面からは busynessFor(id) と busyText(b) を呼ぶ。iCal を使うときは、先に loadCalendarIfConfigured() を await する。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { todayJst } from "./clock";
import { dataFile, dataSource } from "./dataSource";
import { schedules } from "./data";
import { looksLikeIcs, parseIcs, type BusySlot } from "./ics";
import { demoPersonOn, isDemoPerson } from "./demoPerson";
import { runtimeRoot } from "./runtime";

export type { BusySlot } from "./ics";

export const WINDOW_DAYS = 14;
export const WORK_START_HOUR = 10;
export const WORK_END_HOUR = 19;
export type BusyLevel = "余裕あり" | "普通" | "詰まっている";

export type Busyness =
  | {
      known: true;
      /** 0〜1 */
      ratio: number;
      percent: number;
      level: BusyLevel;
      busy_minutes: number;
      work_minutes: number;
      from: string;
      to: string;
      slots: BusySlot[];
      /** iCal を取りに行けず、保存した少し前のカレンダーで計算したとき：読んだ時刻（ISO） */
      calendar_as_of?: string;
    }
  | { known: false; from: string; to: string; slots: [] };

const JST = 9 * 3600_000;
const DAY = 86_400_000;

function dayStartMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - JST;
}
function dateOf(ms: number): string {
  return new Date(ms + JST).toISOString().slice(0, 10);
}
function slotRange(s: BusySlot): [number, number] {
  return s.all_day
    ? [dayStartMs(s.start), dayStartMs(s.end)]
    : [Date.parse(s.start), Date.parse(s.end)];
}

/** 区分の境目：4割未満は余裕あり、6割以上は詰まっている。 */
export function levelOf(ratio: number): BusyLevel {
  if (ratio < 0.4) return "余裕あり";
  if (ratio < 0.6) return "普通";
  return "詰まっている";
}

/** 期間（today から14日）の、計算の対象になる日付の範囲。 */
export function windowOf(today = todayJst()): {
  from: string;
  to: string;
  fromMs: number;
  toMs: number;
} {
  const fromMs = dayStartMs(today);
  const toMs = fromMs + WINDOW_DAYS * DAY;
  return { from: today, to: dateOf(toMs - DAY), fromMs, toMs };
}

/** 予定の一覧から、今後2週間の平日・勤務時間がどれだけ埋まっているかを計算する。 */
export function computeBusyness(
  slots: BusySlot[],
  today = todayJst(),
): Busyness & { known: true } {
  const w = windowOf(today);
  const ranges = slots
    .map(slotRange)
    .filter(([a, b]) => b > a && a < w.toMs && b > w.fromMs);
  let busy = 0;
  let work = 0;
  for (let t = w.fromMs; t < w.toMs; t += DAY) {
    const dow = new Date(t + JST).getUTCDay();
    if (dow === 0 || dow === 6) continue; // 週末は数えない
    const ws = t + WORK_START_HOUR * 3600_000;
    const we = t + WORK_END_HOUR * 3600_000;
    work += we - ws;
    // その日の勤務時間に切り取って、重なりをまとめてから足す
    const clipped = ranges
      .map(([a, b]) => [Math.max(a, ws), Math.min(b, we)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    let curA = -1;
    let curB = -1;
    for (const [a, b] of clipped) {
      if (a > curB) {
        if (curB > curA) busy += curB - curA;
        curA = a;
        curB = b;
      } else curB = Math.max(curB, b);
    }
    if (curB > curA) busy += curB - curA;
  }
  const ratio = work ? busy / work : 0;
  const inWindow = slots
    .filter((s) => {
      const [a, b] = slotRange(s);
      return a < w.toMs && b > w.fromMs;
    })
    .map((s) => ({ start: s.start, end: s.end, all_day: s.all_day }))
    .sort((a, b) => slotRange(a)[0] - slotRange(b)[0]);
  return {
    known: true,
    ratio,
    percent: Math.round(ratio * 100),
    level: levelOf(ratio),
    busy_minutes: Math.round(busy / 60_000),
    work_minutes: Math.round(work / 60_000),
    from: w.from,
    to: w.to,
    slots: inWindow,
  };
}

export function unknownBusyness(today = todayJst()): Busyness {
  const w = windowOf(today);
  return { known: false, from: w.from, to: w.to, slots: [] };
}

// ---- 予定の出どころ ---------------------------------------------------------------

interface CalendarEntry extends BusySlot {
  employee_id: string;
}

let calendarCache: {
  file: string;
  mtime: number;
  byId: Map<string, BusySlot[]>;
} | null = null;

/** 架空データの予定（data/calendar.json）。ファイルがなければ null（＝予定は不明）。 */
function fictionalCalendar(): Map<string, BusySlot[]> | null {
  const file = dataFile("calendar.json");
  if (!fs.existsSync(file)) return null;
  const mtime = fs.statSync(file).mtimeMs;
  if (calendarCache?.file !== file || calendarCache.mtime !== mtime) {
    const byId = new Map<string, BusySlot[]>();
    for (const c of JSON.parse(
      fs.readFileSync(file, "utf-8"),
    ) as CalendarEntry[]) {
      const list = byId.get(c.employee_id) ?? [];
      list.push({ start: c.start, end: c.end, all_day: c.all_day });
      byId.set(c.employee_id, list);
    }
    calendarCache = { file, mtime, byId };
  }
  return calendarCache.byId;
}

/** 出張・休暇などの終日の予定（schedules.json の to は含む日なので、終わりは翌日にする）。 */
function scheduleSlots(employeeId: string): BusySlot[] {
  return schedules()
    .filter((s) => s.employee_id === employeeId)
    .map((s) => ({
      start: s.from,
      end: dateOf(dayStartMs(s.to) + DAY),
      all_day: true,
    }));
}

// iCal（CALENDAR_ICS_URL）。URL は秘密：表示・ログ・保存しない。
//   - 読めたカレンダー（開始・終了・終日かどうかだけ）は data/runtime/calendar_cache.json に保存する（git の対象外）
//   - 前に読んでから30分は Google に取りに行かず、保存したものを使う（429 で断られないように）
//   - 取りに行って失敗したら（429・通信できないなど）、保存した最後のものを使い、画面に「少し前のカレンダー」と読んだ時刻を出す
//   - 保存したものがなく、取りにも行けないときだけ「予定は不明」
//   - 保存したものは、どの URL のものかを URL のハッシュ（先頭12文字）で見分ける（URL を差し替えたら前のものは使わない）
/** 前に読んでから、この時間は取りに行かない */
export const ICS_FRESH_MS = 30 * 60_000;
/** 取りに行って失敗したあと、次に取りに行くまで */
export const ICS_RETRY_MS = 10 * 60_000;
/** iCal を読む範囲（今日から）。忙しさは2週間で計算し、空いていそうな日（lib/dateHint.ts）はこの範囲で探す */
export const ICS_READ_DAYS = 183;
export const CALENDAR_CACHE_NAME = "calendar_cache.json";

interface IcsSaved {
  /** URL のハッシュ（先頭12文字）。URL そのものは保存しない */
  key: string;
  /** 読んだ時刻（ISO） */
  fetched_at: string;
  /** 読んだ範囲の最後の日 */
  until: string;
  slots: BusySlot[];
}
let icsCache: IcsSaved | null = null;
let lastFail: { key: string; at: number } | null = null;
let inFlight: Promise<void> | null = null;

/** 保存する場所（data/runtime/calendar_cache.json。テストでは一時フォルダ） */
export function calendarCacheFile(): string {
  return path.join(runtimeRoot(), CALENDAR_CACHE_NAME);
}

const keyMemo = { url: "", key: "" };
function urlKey(url: string): string {
  if (keyMemo.url !== url) {
    keyMemo.url = url;
    keyMemo.key = createHash("sha256").update(url).digest("hex").slice(0, 12);
  }
  return keyMemo.key;
}
function currentKey(): string | null {
  const url = process.env.CALENDAR_ICS_URL?.trim();
  return url ? urlKey(url) : null;
}

function readSaved(key: string): IcsSaved | null {
  try {
    const file = calendarCacheFile();
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return null;
    const v = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf-8")) as IcsSaved;
    if (v.key !== key || !Array.isArray(v.slots) || Number.isNaN(Date.parse(v.fetched_at))) return null;
    return { key: v.key, fetched_at: v.fetched_at, until: v.until, slots: v.slots.map((s) => ({ start: s.start, end: s.end, all_day: s.all_day })) };
  } catch {
    return null; // 壊れていたら、ないものとして取りに行く
  }
}

function writeSaved(v: IcsSaved): void {
  try {
    const file = calendarCacheFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(v) + "\n", "utf-8");
    fs.renameSync(tmp, file); // 書きかけを別のプロセスに読ませない
  } catch (e) {
    console.error(`カレンダーを保存できませんでした（${e instanceof Error ? e.message : "不明なエラー"}）。保存しないまま続けます`);
  }
}

const ageMs = (v: IcsSaved) => Date.now() - Date.parse(v.fetched_at);

/** 日本時間の「7:41」（今日でなければ「11/21 18:05」） */
export function readTimeText(iso: string, today = todayJst()): string {
  const d = new Date(Date.parse(iso) + JST);
  const hm = `${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  return d.toISOString().slice(0, 10) === today ? hm : `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hm}`;
}

/**
 * iCal の設定があるときだけ読み込む。前に読んでから30分は取りに行かない（保存したものを使う）。
 * 失敗したら保存した最後のものを使う。何もなければ「予定は不明」。同時に呼ばれても取りに行くのは1回。
 */
export async function loadCalendarIfConfigured(): Promise<void> {
  const url = process.env.CALENDAR_ICS_URL?.trim();
  if (!url || (dataSource() !== "github" && !demoPersonOn())) return;
  const key = urlKey(url);
  // メモリにないか古ければ、保存したものを読む（別のプロセスが新しく読んでいることもある）
  if (!icsCache || icsCache.key !== key || ageMs(icsCache) >= ICS_FRESH_MS) {
    const saved = readSaved(key);
    if (saved && (!icsCache || icsCache.key !== key || Date.parse(saved.fetched_at) > Date.parse(icsCache.fetched_at))) icsCache = saved;
    else if (icsCache && icsCache.key !== key) icsCache = null;
  }
  if (icsCache && ageMs(icsCache) < ICS_FRESH_MS) return;
  if (lastFail && lastFail.key === key && Date.now() - lastFail.at < ICS_RETRY_MS) return;
  if (!inFlight) inFlight = fetchCalendar(url, key).finally(() => (inFlight = null));
  return inFlight;
}

async function fetchCalendar(url: string, key: string): Promise<void> {
  // ログには URL を出さない（理由・ステータス・件数だけ）
  const fail = (why: string) => {
    lastFail = { key, at: Date.now() };
    const fallback =
      icsCache?.key === key
        ? `。保存した ${readTimeText(icsCache.fetched_at)} のカレンダーを使います`
        : "。保存したカレンダーもないので「予定は不明」になります";
    console.error(`カレンダー（CALENDAR_ICS_URL）を読めませんでした：${why.replace(/https?:\/\/\S+/g, "（URL）")}${fallback}`);
  };
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "text/calendar" } });
  } catch (e) {
    return fail(`取得に失敗（${e instanceof Error ? e.message : "不明なエラー"}）`);
  }
  if (!res.ok) return fail(`HTTP ${res.status}${urlHint(url, res.status)}`);
  const text = await res.text();
  if (!looksLikeIcs(text)) return fail(`HTTP ${res.status} ですが、中身が iCal ではありません（${res.headers.get("content-type") ?? "種類不明"}・${text.length}文字）`);
  try {
    const w = windowOf();
    const readTo = w.fromMs + ICS_READ_DAYS * DAY;
    const slots = parseIcs(text, new Date(w.fromMs), new Date(readTo));
    icsCache = { key, fetched_at: new Date().toISOString(), until: dateOf(readTo - DAY), slots };
    lastFail = null;
    writeSaved(icsCache);
    const events = (text.match(/BEGIN:VEVENT/g) ?? []).length;
    const inWindow = slots.filter((s) => slotRange(s)[0] < w.toMs).length;
    console.log(`カレンダー（CALENDAR_ICS_URL）を読みました：予定${events}件のうち、今後2週間（${w.from}〜${w.to}）にかかる予定${inWindow}件（空いていそうな日を探すため、${icsCache.until} まで読んでいます。30分は読み直しません）`);
  } catch (e) {
    fail(`読み取りに失敗（${e instanceof Error ? e.message : "不明なエラー"}）`);
  }
}

/** 失敗したときの手がかり（URL の種類だけを見る。値は出さない） */
function urlHint(url: string, status: number): string {
  if (status === 429) return "（短い間に何度も取りに行ったため、断られました）";
  try {
    const u = new URL(url);
    if (u.hostname === "calendar.google.com" && u.pathname.split("/").includes("public") && (status === 404 || status === 403))
      return "。Google カレンダーの「公開アドレス」は、カレンダーを一般公開していないと 404 になります。設定の「iCal 形式の非公開アドレス」（…/private-…/basic.ics）を使ってください";
    if (status === 404) return "。アドレスが変わった（非公開アドレスをリセットした）可能性があります";
  } catch {
    return "。URL の形が正しくありません";
  }
  return "";
}

/** テスト用：メモリに読み込んだ iCal を忘れる（保存したファイルは消さない。消すときは files: true） */
export function clearCalendarCache(opts: { files?: boolean } = {}): void {
  icsCache = null;
  lastFail = null;
  if (opts.files) fs.rmSync(calendarCacheFile(), { force: true });
}

/** 使っているカレンダー（URL が今の設定と同じものだけ） */
function currentIcs(): IcsSaved | null {
  const key = currentKey();
  return key && icsCache?.key === key ? icsCache : null;
}

/** 少し前のカレンダー（取りに行けず、保存したものを使っている）なら、読んだ時刻（ISO）。新しければ null */
export function calendarStaleAt(): string | null {
  const c = currentIcs();
  return c && ageMs(c) >= ICS_FRESH_MS ? c.fetched_at : null;
}

/** 調べる用：iCal の読み込みの状態（件数だけ。URL は出さない）。 */
export function calendarStatus(): string {
  if (!process.env.CALENDAR_ICS_URL?.trim()) return "CALENDAR_ICS_URL なし";
  const c = currentIcs();
  if (!c) return lastFail ? "読み込みに失敗（ログを確認）。保存したカレンダーもない" : "まだ読み込んでいない（DATA_SOURCE=github か DEMO_PERSON=on のときだけ読む）";
  const w = windowOf();
  const n = c.slots.filter((s) => slotRange(s)[0] < w.toMs && slotRange(s)[1] > w.fromMs).length;
  const when = `${readTimeText(c.fetched_at)} に読んだもの`;
  const head = calendarStaleAt() ? `読み込みに失敗したので、保存した少し前のカレンダーを使っている（${when}）` : `読み込み済み（${when}）`;
  return `${head}：今後2週間の予定 ${n}件（${c.until} まで読んでいる）`;
}

/** 予定の一覧。分からなければ null。 */
/** 予定を iCal から読む人か（DATA_SOURCE=github の本人、または DEMO_PERSON=on の31人目） */
export function usesIcs(employeeId: string): boolean {
  return dataSource() === "github" || isDemoPerson(employeeId);
}

export function slotsFor(employeeId: string): BusySlot[] | null {
  if (usesIcs(employeeId)) {
    // 本人の予定は iCal だけ（架空の schedules・calendar は使わない）
    return currentIcs()?.slots ?? null;
  }
  const cal = fictionalCalendar();
  if (!cal) return null;
  return [...(cal.get(employeeId) ?? []), ...scheduleSlots(employeeId)];
}

/**
 * 予定が分かるのはいつまでか（空いていそうな日を、この日より先には出さない）。予定が分からない人は null。
 * 架空データは data/calendar.json のいちばん遅い予定の日、iCal は読んだ範囲の最後の日。
 */
export function knownUntilFor(employeeId: string): string | null {
  if (usesIcs(employeeId)) return currentIcs()?.until ?? null;
  const cal = fictionalCalendar();
  if (!cal) return null;
  let last = "";
  for (const list of cal.values()) for (const s of list) if (s.end.slice(0, 10) > last) last = s.end.slice(0, 10);
  return last || null;
}

export function busynessFor(employeeId: string, today = todayJst()): Busyness {
  const slots = slotsFor(employeeId);
  if (!slots) return unknownBusyness(today);
  const b = computeBusyness(slots, today);
  const staleAt = usesIcs(employeeId) ? calendarStaleAt() : null;
  return staleAt ? { ...b, calendar_as_of: staleAt } : b;
}

// ---- 言葉にする ---------------------------------------------------------------------

/** 使う人（技術広報）向けの言い方。「忙しさ5」のような段階は出さない。 */
export function busyText(b: Busyness): string {
  if (!b.known) return "予定は不明";
  const tenths = Math.round(b.ratio * 10);
  const text =
    tenths === 0
      ? "今後2週間は予定がほとんど入っていない"
      : tenths >= 10
        ? "今後2週間は勤務時間がほぼ予定で埋まっている"
        : `今後2週間は勤務時間の${tenths}割が予定で埋まっている`;
  // 取りに行けず保存したものを使ったときは、読んだ時刻を小さく添える
  return b.calendar_as_of ? `${text}（少し前のカレンダー：${readTimeText(b.calendar_as_of)} に読んだもの）` : text;
}

/** Agent に渡す短い形（数字と区分）。 */
export function busyForAgent(b: Busyness): string {
  return b.known ? `予定の埋まり${b.percent}%（${b.level}）` : "予定は不明";
}
