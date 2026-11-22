// 受信箱の依頼で日程が決まっていないとき、候補ごとに「空いていそうな日」をまとめる（AI は使わない）。
// 期間への変換と日の選び方は lib/dateHint.ts、予定は lib/busyness.ts（架空データの calendar.json・schedules.json、本人は iCal）。
// 主催者への返事に入れる1文（reply_sentence）は材料だけ。入れるかどうかは技術広報が選ぶ。
// 会話に開催日の候補が2〜4日はっきり書いてあるとき（candidate_dates）は、候補日ごとの都合（○・×・?）を出し、
// 「空いていそうな日」は候補日の中の○の日にする。返事の1文も候補日から作る（lib/dateHint.ts の candidateDatesReply）。
import { knownUntilFor, loadCalendarIfConfigured, slotsFor } from "./busyness";
import { todayJst, nowJst } from "./clock";
import {
  candidateDatesNote,
  candidateDatesReply,
  dayAvailability,
  hintToPeriod,
  replySentence,
  shortDate,
  suggestDates,
  suggestHours,
  type DayMark,
  type Period,
} from "./dateHint";
import type { IntakeReading } from "./intake";

export interface CandidateDay {
  date: string;
  mark: DayMark;
}

export interface CandidateDates {
  employee_id: string;
  name: string;
  /** カレンダーで予定が分かる人か（false なら「予定は不明」で、日は出さない） */
  known: boolean;
  /** 空いていそうな日（YYYY-MM-DD、最大3日）。候補日があるときは、候補日の中の○の日 */
  dates: string[];
  /** 技術広報向けの補足（予定は不明・予定が分かる範囲の外・見つからない など） */
  note: string | null;
  /** 主催者への返事に入れてよい1文（「1月20日（水）あたりなら調整しやすそうです（本人に確認します）。」）。日がなければ null */
  reply_sentence: string | null;
  /** 候補日ごとの都合（候補日があるときだけ） */
  candidate_days?: CandidateDay[];
  /** 候補日の都合をまとめた注意点（「候補日のうち 1/14 だけ都合がよい」。候補日があるときだけ） */
  candidate_note?: string | null;
}

export interface DateSuggestions {
  /** 会話にあった時期の手がかり（そのまま）。なければ null */
  hint: string | null;
  period: Period;
  /** 見た時間帯（日本時間、平日だけ） */
  hours: { start: number; end: number };
  candidates: CandidateDates[];
  computed_at: string;
  /** 会話に書かれた開催日の候補（2〜4日）。なければ出さない */
  candidate_dates?: string[];
}

/** 1人分の候補日の都合 */
export function candidateDaysFor(employeeId: string, days: string[], hours = suggestHours()): CandidateDay[] {
  const slots = slotsFor(employeeId);
  const knownUntil = knownUntilFor(employeeId);
  return days.map((date) => ({ date, mark: dayAvailability(slots, date, { knownUntil, hours }) }));
}

/**
 * 日程が決まっていない依頼だけ作る（決まっていれば null）。候補日（candidateDates）があれば、日程が決まっていなくても候補日ごとの都合を作る。
 * iCal を使う人がいれば先に読み込む（失敗したらその人は「予定は不明」）。
 */
export async function buildDateSuggestions(
  intake: IntakeReading | null | undefined,
  candidates: Array<{ employee_id: string; name: string }>,
  today = todayJst(),
  candidateDates: string[] | null = null,
): Promise<DateSuggestions | null> {
  if (!candidates.length) return null;
  if (candidateDates?.length) {
    await loadCalendarIfConfigured();
    const hours = suggestHours();
    return {
      hint: intake?.date_hint ?? null,
      period: { from: candidateDates[0], to: candidateDates[candidateDates.length - 1], label: `候補日（${candidateDates.map(shortDate).join("・")}）`, from_hint: true },
      hours,
      candidate_dates: candidateDates,
      candidates: candidates.map((c) => {
        const days = candidateDaysFor(c.employee_id, candidateDates, hours);
        const known = days.some((d) => d.mark !== "unknown");
        return {
          employee_id: c.employee_id,
          name: c.name,
          known,
          dates: days.filter((d) => d.mark === "ok").map((d) => d.date),
          note: known ? null : "予定は不明（カレンダーがないため、候補日の都合は分かりません）",
          reply_sentence: candidateDatesReply(days),
          candidate_days: days,
          candidate_note: candidateDatesNote(days),
        };
      }),
      computed_at: nowJst(),
    };
  }
  if (!intake || intake.date) return null;
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
