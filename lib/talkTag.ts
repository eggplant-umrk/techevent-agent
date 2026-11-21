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

/**
 * 注意点のうち、登壇経験の印と同じことだけを言っている文か（例：「登壇経験なし（初登壇）」「登壇は初めてです」
 * 「最後の登壇は2025年11月」）。印がすでに理由の近くに出ているので、表示の前に取り除く。
 * ほかのことも言っている文（例：「登壇経験はなく、30分のセッションは初めて」）は残す。
 */
export function repeatsTalkTag(caution: string): boolean {
  const t = caution.replace(/[。．.、，,\s]/g, "").replace(/(です|ます|でした)$/, "");
  return [
    /^登壇(の)?経験(は|が)?(なし|なく|ない|ありません|ゼロ|0回)(（初登壇）|\(初登壇\))?$/,
    /^登壇(は|が)?(初めて|はじめて)(（初登壇）)?$/,
    /^初(めての)?登壇(になる|となる)?$/,
    /^(最後の|最終|直近の)登壇(は|日は?)?[0-9０-９年月日/\-]+(ごろ|頃)?$/,
    /^最近登壇した(（[0-9-]+）)?$/,
    /^半年以内に登壇(した|している)?(（[^）]*）)?$/,
    /^登壇(の)?経験(は|が)?(あり|ある)(（?[0-9]+回）?)?$/,
  ].some((re) => re.test(t));
}

/** 注意点から、登壇経験の印と重なるものを除く。 */
export function withoutTalkTagRepeats(cautions: string[]): string[] {
  return cautions.filter((c) => !repeatsTalkTag(c));
}
