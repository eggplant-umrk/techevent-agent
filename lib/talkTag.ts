// 候補に付ける登壇経験の印（コードで決める。AIは使わない）。
// 経験で順位は変えない。印を理由の近くに出して、選ぶのは人（技術広報）。
import { TODAY } from "./config";

export type TalkTag = "初登壇" | "半年以内に登壇" | "登壇経験あり";

/** 半年＝183日。最後の登壇がこれ以内なら「半年以内に登壇」 */
const RECENT_DAYS = 183;

export function talkTag(e: { past_talk_count: number; last_talk_date: string | null }, today = TODAY): TalkTag {
  if (!e.past_talk_count) return "初登壇";
  if (e.last_talk_date && (Date.parse(today) - Date.parse(e.last_talk_date)) / 86_400_000 <= RECENT_DAYS) return "半年以内に登壇";
  return "登壇経験あり";
}
