// 本人の予定（iCal）がどこで止まっているかを調べる（API代はかからない）。
//   npx tsx scripts/diag_calendar.ts
// 出すのは「ある／なし」・HTTPステータス・件数・計算結果だけ。CALENDAR_ICS_URL の値と、予定のタイトル・場所・参加者は出さない。
import fs from "node:fs";

async function main() {
  if (fs.existsSync(".env")) process.loadEnvFile(".env"); // アプリと同じく .env をこのプロセスにだけ読む（表示しない）
  const url = process.env.CALENDAR_ICS_URL?.trim();
  console.log(`1. CALENDAR_ICS_URL：${url ? "あり" : "なし"}／DEMO_PERSON：${process.env.DEMO_PERSON?.trim() || "（なし）"}／DATA_SOURCE：${process.env.DATA_SOURCE?.trim() || "（既定）"}`);
  if (!url) return;

  const { windowOf, busynessFor, busyText, loadCalendarIfConfigured, usesIcs, calendarStatus } = await import("../lib/busyness");
  const { parseIcs, icsStats } = await import("../lib/ics");
  const { DEMO_ID } = await import("../lib/demoPerson");

  let text = "";
  try {
    const res = await fetch(url, { headers: { Accept: "text/calendar" } });
    text = await res.text();
    console.log(`2. 取得：HTTP ${res.status}／${text.length}文字／Content-Type ${res.headers.get("content-type") ?? "なし"}`);
  } catch (e) {
    console.log(`2. 取得に失敗：${e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, "（URL）") : "不明"}`);
    return;
  }
  const st = icsStats(text);
  console.log(`   予定（VEVENT）${st.events}件／繰り返し ${st.rrule}件（WEEKLY ${st.weekly}・BYDAY 複数 ${st.multiByday}・INTERVAL>1 ${st.interval}・UNTIL ${st.until}・COUNT ${st.count}）`);
  console.log(`   時刻の形：UTC ${st.utc}・TZID ${st.tzid}（${st.tzids.join("、") || "なし"}）・終日 ${st.allDay}・その他 ${st.otherTime}／変更された回（RECURRENCE-ID）${st.recurrenceId}／EXDATE ${st.exdate}`);

  const w = windowOf();
  const slots = parseIcs(text, new Date(w.fromMs), new Date(w.toMs));
  console.log(`3. 今後2週間（${w.from}〜${w.to}）に読み取れた予定：${slots.length}件（終日 ${slots.filter((s) => s.all_day).length}件）`);

  await loadCalendarIfConfigured();
  console.log(`4. アプリの読み込み：${calendarStatus()}`);
  console.log(`   本人（${DEMO_ID}）が iCal を使う設定か：${usesIcs(DEMO_ID) ? "はい" : "いいえ"}`);
  const b = busynessFor(DEMO_ID);
  console.log(`   計算結果：${busyText(b)}${b.known ? `（${b.percent}%・${b.level}・予定${b.slots.length}件）` : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, "（URL）") : e);
  process.exit(1);
});
