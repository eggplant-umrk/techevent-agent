// ネタ帳タブ（人の画面）の「予定」欄。忙しさの計算（lib/busyness.ts）を呼んで、画面の形にする。
// - 埋まり具合：busynessFor / busyText（「今後2週間は勤務時間の7割が予定で埋まっている」）
// - 今後2週間の予定：時刻だけ（予定のタイトル・場所・参加者は持たないし出さない）
// iCal を使う人（DEMO_PERSON=on の本人など）は、呼ぶ前に loadCalendarIfConfigured() を await しておく。
import { busynessFor, busyText, type BusyLevel } from "./busyness";
import { TODAY } from "./config";

export interface Availability {
  /** 予定の埋まり具合（0〜1）。予定が分からなければ null（画面は「予定は不明」） */
  load: number | null;
  /** 区分（余裕あり・普通・詰まっている）。分からなければ null */
  level: BusyLevel | null;
  /** 使う人向けの言葉（busyText） */
  text: string;
  /** 今後2週間の予定（開始・終了・終日だけ）。分からなければ null */
  upcoming: Array<{ start: string; end: string; all_day: boolean }> | null;
  /** 数えた期間 */
  from: string;
  to: string;
}

export function getAvailability(employeeId: string, today = TODAY): Availability {
  const b = busynessFor(employeeId, today);
  if (!b.known) return { load: null, level: null, text: busyText(b), upcoming: null, from: b.from, to: b.to };
  return {
    load: b.ratio,
    level: b.level,
    text: busyText(b),
    upcoming: [...b.slots].sort((x, y) => (x.start < y.start ? -1 : 1)).map((s) => ({ start: s.start, end: s.end, all_day: s.all_day })),
    from: b.from,
    to: b.to,
  };
}
