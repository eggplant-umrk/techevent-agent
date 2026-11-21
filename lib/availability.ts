// 予定の埋まり具合と今後2週間の予定。
// セッション③（feature/calendar）が「忙しさの計算」を作っている。ここはその計算を呼ぶ場所だけ用意する。
// ③が入ったら、getAvailability の中身を ③の計算の呼び出しに差し替える（画面と人の一覧はこの形のまま使う）。
import { TODAY } from "./config";

export interface Availability {
  /** 予定の埋まり具合（0〜1）。計算ができるまでは null（画面は「—」） */
  load: number | null;
  /** 今後2週間の予定。計算ができるまでは null（画面は「予定の計算ができたらここに出ます」） */
  upcoming: Array<{ date: string; title: string }> | null;
  /** どこから来た値か。pending＝まだ計算していない */
  source: "pending" | "calendar";
  /** いつ時点か */
  as_of: string;
}

export function getAvailability(_employeeId: string, today = TODAY): Availability {
  return { load: null, upcoming: null, source: "pending", as_of: today };
}
