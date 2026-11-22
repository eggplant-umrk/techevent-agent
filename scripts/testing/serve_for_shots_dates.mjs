// 画面の画像の 02b（候補日ごとの都合）を撮るための試し用サーバー（scripts/take_screenshots.mjs）：偽の API・一時フォルダ・本番用のビルド・3271番。
// 本人（DEMO_PERSON=on）の予定に、12/14〜18 の終日の予定を入れた iCal（data: URL）を読ませる。本物のカレンダーは使わない
import path from "node:path";
import { buildApp, startApp, tempDir } from "./app_server.mjs";
import { startFakeAnthropic } from "./fake_anthropic.mjs";

const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:shots-1214", "DTSTART;VALUE=DATE:20261214", "DTEND;VALUE=DATE:20261219", "SUMMARY:終日の予定", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const dir = tempDir("shots-dates");
const fake = await startFakeAnthropic({});
buildApp(fake.url);
const app = await startApp({
  profile: "present",
  port: Number(process.env.E2E_PORT || 3271),
  fakeUrl: fake.url,
  dir,
  logFile: path.join(dir, "server.log"),
  extraEnv: { DEMO_PERSON: "on", CALENDAR_ICS_URL: `data:text/calendar;base64,${Buffer.from(ics).toString("base64")}` },
});
console.log(`ready on ${app.base}（置き場 ${dir}）`);
setInterval(() => undefined, 60_000);
