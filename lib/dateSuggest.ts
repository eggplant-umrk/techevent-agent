// 受信箱の依頼で日程が決まっていないとき、候補ごとに「空いていそうな日」をまとめる（AI は使わない）。
// 期間への変換と日の選び方は lib/dateHint.ts、予定は lib/busyness.ts（架空データの calendar.json・schedules.json、本人は iCal）。
// 主催者への返事に入れる1文（reply_sentence）は材料だけ。入れるかどうかは技術広報が選ぶ。
import { knownUntilFor, loadCalendarIfConfigured, slotsFor } from "./busyness";
import { todayJst, nowJst } from "./clock";
import { hintToPeriod, replySentence, suggestDates, suggestHours, type Period } from "./dateHint";
import type { IntakeReading } from "./intake";

export interface CandidateDates {
  employee_id: string;
  name: string;
  /** カレンダーで予定が分かる人か（false なら「予定は不明」で、日は出さない） */
  known: boolean;
  /** 空いていそうな日（YYYY-MM-DD、最大3日） */
  dates: string[];
  /** 技術広報向けの補足（予定は不明・予定が分かる範囲の外・見つからない など） */
  note: string | null;
  /** 主催者への返事に入れてよい1文（「1月20日（水）あたりなら調整しやすそうです（本人に確認します）。」）。日がなければ null */
  reply_sentence: string | null;
}

export interface DateSuggestions {
  /** 会話にあった時期の手がかり（そのまま）。なければ null */
  hint: string | null;
  period: Period;
  /** 見た時間帯（日本時間、平日だけ） */
  hours: { start: number; end: number };
  candidates: CandidateDates[];
  computed_at: string;
}

/**
 * 日程が決まっていない依頼だけ作る（決まっていれば null）。
 * iCal を使う人がいれば先に読み込む（失敗したらその人は「予定は不明」）。
 */
export async function buildDateSuggestions(
  intake: IntakeReading | null | undefined,
  candidates: Array<{ employee_id: string; name: string }>,
  today = todayJst(),
): Promise<DateSuggestions | null> {
  if (!intake || intake.date || !candidates.length) return null;
  await loadCalendarIfConfigured();
  const period = hintToPeriod(intake.date_hint ?? null, today);
  const hours = suggestHours();
  return {
    hint: intake.date_hint ?? null,
    period,
    hours,
    candidates: candidates.map((c) => {
      const s = suggestDates(slotsFor(c.employee_id), period, { knownUntil: knownUntilFor(c.employee_id), hours });
      return { employee_id: c.employee_id, name: c.name, known: s.known, dates: s.dates, note: s.note, reply_sentence: replySentence(s.dates) };
    }),
    computed_at: nowJst(),
  };
}
