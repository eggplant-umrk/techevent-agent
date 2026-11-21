// 「今日」と「今」を日本時間で返す（前は lib/config.ts で 2026-11-21 に固定していた）。
//   - 評価・テストだけは FIXED_TODAY=YYYY-MM-DD で日付を固定して動かす（scripts/_isolate.ts が設定する）
//   - 記録する日時は日本時間の ISO 形式（例：2026-11-21T18:30:00.000+09:00）。日付だけの項目（打診の日など）も日本時間の日付
// 日本には夏時間がないので、UTC に9時間足すだけでよい。

const JST_MS = 9 * 3600_000;

/** 今日の日付（日本時間、YYYY-MM-DD）。FIXED_TODAY があればその日 */
export function todayJst(): string {
  const fixed = process.env.FIXED_TODAY?.trim();
  if (fixed && /^\d{4}-\d{2}-\d{2}$/.test(fixed)) return fixed;
  return new Date(Date.now() + JST_MS).toISOString().slice(0, 10);
}

/** 今の日時（日本時間の ISO 形式、+09:00 つき）。記録に使う */
export function nowJst(): string {
  return new Date(Date.now() + JST_MS).toISOString().replace("Z", "+09:00");
}

/** ISO 形式の日時（Z でも +09:00 でもよい）を比べる。新しい順に並べるときに使う（文字列のままだと形の違いで順番が崩れる） */
export function byTimeDesc(a: string, b: string): number {
  return Date.parse(b) - Date.parse(a);
}
