// 忙しさの計算と iCal の読み込みのテスト（APIは使わない）。
//   npm run test:busyness
import fs from "node:fs";
import path from "node:path";
import {
  busynessFor,
  busyText,
  computeBusyness,
  levelOf,
  loadCalendarIfConfigured,
  windowOf,
  type BusySlot,
} from "../lib/busyness";
import { parseIcs } from "../lib/ics";
import { internalTerms } from "../lib/plainText";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

async function main() {
  const TODAY = "2026-11-21"; // 土曜日。期間は 11/21〜12/4、平日は10日（11/23〜27、11/30〜12/4）
  const WORK = 10 * 9 * 60;
  const t = (d: string, h: number, m = 0) =>
    `${d}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`;

  // ---- 割合の計算 ----
  {
    const b = computeBusyness([], TODAY);
    check(
      "予定なし：0%・余裕あり、勤務時間は平日10日×9時間",
      b.percent === 0 && b.level === "余裕あり" && b.work_minutes === WORK,
      `${b.percent}% ${b.work_minutes}分`,
    );
    check(
      "期間は今日から14日",
      b.from === "2026-11-21" && b.to === "2026-12-04",
      `${b.from}〜${b.to}`,
    );
  }
  {
    const b = computeBusyness(
      [
        {
          start: t("2026-11-24", 10),
          end: t("2026-11-24", 14),
          all_day: false,
        },
      ],
      TODAY,
    );
    check(
      "4時間の予定1件：240分",
      b.busy_minutes === 240,
      `${b.busy_minutes}分`,
    );
  }
  {
    const b = computeBusyness(
      [
        {
          start: t("2026-11-24", 10),
          end: t("2026-11-24", 12),
          all_day: false,
        },
        {
          start: t("2026-11-24", 11),
          end: t("2026-11-24", 13),
          all_day: false,
        },
      ],
      TODAY,
    );
    check(
      "重なった予定は二重に数えない：180分",
      b.busy_minutes === 180,
      `${b.busy_minutes}分`,
    );
  }
  {
    const b = computeBusyness(
      [
        { start: t("2026-11-24", 8), end: t("2026-11-24", 11), all_day: false },
        {
          start: t("2026-11-24", 18),
          end: t("2026-11-24", 22),
          all_day: false,
        },
      ],
      TODAY,
    );
    check(
      "勤務時間（10〜19時）の外は数えない：60＋60分",
      b.busy_minutes === 120,
      `${b.busy_minutes}分`,
    );
  }
  {
    const b = computeBusyness(
      [
        {
          start: t("2026-12-10", 10),
          end: t("2026-12-10", 19),
          all_day: false,
        },
      ],
      TODAY,
    );
    check(
      "期間の外（12/10）の予定は数えない・一覧にも出さない",
      b.busy_minutes === 0 && b.slots.length === 0,
      `${b.busy_minutes}分 ${b.slots.length}件`,
    );
  }
  {
    const slots: BusySlot[] = [];
    for (const d of [
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
      "2026-11-27",
      "2026-11-30",
      "2026-12-01",
    ])
      slots.push({ start: t(d, 10), end: t(d, 19), all_day: false });
    const b = computeBusyness(slots, TODAY);
    check(
      "平日10日のうち7日が埋まる：70%・詰まっている・「7割」",
      b.percent === 70 &&
        b.level === "詰まっている" &&
        busyText(b).includes("7割"),
      `${b.percent}% ${b.level} ${busyText(b)}`,
    );
  }

  // ---- 終日の予定 ----
  {
    const b = computeBusyness(
      [{ start: "2026-11-26", end: "2026-11-27", all_day: true }],
      TODAY,
    );
    check(
      "終日の予定（平日1日）：その日の勤務時間ぶん540分",
      b.busy_minutes === 540,
      `${b.busy_minutes}分`,
    );
  }
  {
    const b = computeBusyness(
      [{ start: "2026-11-24", end: "2026-12-01", all_day: true }],
      TODAY,
    );
    check(
      "終日の予定（11/24〜11/30、週末をまたぐ）：平日5日ぶん",
      b.busy_minutes === 5 * 540,
      `${b.busy_minutes}分`,
    );
  }

  // ---- 週末の除外 ----
  {
    const b = computeBusyness(
      [
        { start: "2026-11-28", end: "2026-11-30", all_day: true },
        {
          start: t("2026-11-21", 10),
          end: t("2026-11-21", 19),
          all_day: false,
        },
      ],
      TODAY,
    );
    check(
      "週末の予定は数えない（終日・時間指定とも）",
      b.busy_minutes === 0 && b.slots.length === 2,
      `${b.busy_minutes}分、一覧${b.slots.length}件`,
    );
    const w = windowOf(TODAY);
    check(
      "週末は勤務時間にも入れない",
      b.work_minutes === WORK,
      `${b.work_minutes}分（${w.from}〜${w.to}）`,
    );
  }

  // ---- 区分の境目 ----
  check(
    "区分：39%は余裕あり・40%は普通・60%は詰まっている",
    levelOf(0.39) === "余裕あり" &&
      levelOf(0.4) === "普通" &&
      levelOf(0.6) === "詰まっている",
  );

  // ---- 使う人向けの言葉 ----
  {
    const b = computeBusyness(
      [{ start: "2026-11-23", end: "2026-11-28", all_day: true }],
      TODAY,
    );
    const text = busyText(b);
    check(
      "言葉に段階・数字の%を出さない",
      !/忙しさ|%|[1-5]段階/.test(text) && internalTerms(text).length === 0,
      text,
    );
    check(
      "内部の言葉の判定が「忙しさ5」「忙しさが4」を見つける",
      internalTerms("忙しさ5で準備時間が取れるか").length > 0 &&
        internalTerms("忙しさが4なので").length > 0,
    );
  }

  // ---- 架空データ（data/calendar.json ＋ schedules.json） ----
  {
    delete process.env.DATA_SOURCE;
    const e002 = busynessFor("e002");
    const e012 = busynessFor("e012");
    const e015 = busynessFor("e015");
    check(
      "架空データ：e002・e015 は詰まっている、e012 は余裕あり（評価の正解の前提と同じ）",
      e002.known &&
        e002.level === "詰まっている" &&
        e015.known &&
        e015.level === "詰まっている" &&
        e012.known &&
        e012.level === "余裕あり",
      [e002, e012, e015]
        .map((b) => (b.known ? `${b.percent}%` : "不明"))
        .join(" / "),
    );
    check(
      "架空データ：出張などの終日の予定（schedules）も数える",
      e015.known && e015.slots.some((s) => s.all_day),
      e015.known ? `${e015.slots.filter((s) => s.all_day).length}件` : "",
    );
    check(
      "予定の一覧は開始・終了・終日かどうかだけ",
      e002.slots.every(
        (s) => Object.keys(s).sort().join(",") === "all_day,end,start",
      ),
    );
  }

  // ---- 予定不明（本人：data/sources/github/ の e001） ----
  {
    process.env.DATA_SOURCE = "github";
    delete process.env.CALENDAR_ICS_URL;
    await loadCalendarIfConfigured();
    const b = busynessFor("e001");
    check(
      "本人（GitHub）：予定データがないので「予定は不明」、数字なし",
      !b.known && busyText(b) === "予定は不明" && !("percent" in b),
      busyText(b),
    );
  }

  // ---- .ics の読み込み ----
  const icsText = fs.readFileSync(
    path.join(process.cwd(), "scripts", "fixtures", "sample.ics"),
    "utf-8",
  );
  {
    const w = windowOf(TODAY);
    const slots = parseIcs(icsText, new Date(w.fromMs), new Date(w.toMs));
    const json = JSON.stringify(slots);
    check(
      ".ics：時刻・終日・繰り返し（EXDATE を除く）・週末を読み、中止と「空き」の予定は除く：7件",
      slots.length === 7,
      `${slots.length}件`,
    );
    check(
      ".ics：TZID 付きは日本時間、UTC（Z）は日本時間に直す",
      slots.some((s) => s.start === t("2026-11-24", 10)) &&
        slots.some((s) => s.start === t("2026-11-25", 14)),
    );
    check(
      ".ics：終日（VALUE=DATE）は日付で、終わりは翌日",
      slots.some(
        (s) => s.all_day && s.start === "2026-11-26" && s.end === "2026-11-27",
      ),
    );
    check(
      ".ics：毎週の繰り返しは EXDATE の回（11/27）を除く",
      !slots.some((s) => s.start.startsWith("2026-11-27")) &&
        slots.some((s) => s.start === t("2026-11-30", 16)),
    );
    check(
      ".ics：タイトル・場所・参加者・説明は読まない",
      !/架空|会議室|mailto|example|説明|SUMMARY|LOCATION|ATTENDEE/.test(json) &&
        slots.every(
          (s) => Object.keys(s).sort().join(",") === "all_day,end,start",
        ),
    );
    const b = computeBusyness(slots, TODAY);
    // 120（11/24）＋60（11/25）＋540（11/26 終日）＋60×3（毎週：11/23・11/30・12/4）＝900分
    check(
      ".ics → 同じ計算：900分（17%）",
      b.busy_minutes === 900 && b.percent === 17,
      `${b.busy_minutes}分 ${b.percent}%`,
    );
  }

  // ---- 設定（CALENDAR_ICS_URL）があるときだけ iCal を使う ----
  {
    process.env.DATA_SOURCE = "github";
    process.env.CALENDAR_ICS_URL = `data:text/calendar;base64,${Buffer.from(icsText).toString("base64")}`;
    await loadCalendarIfConfigured();
    const b = busynessFor("e001", TODAY);
    check(
      "CALENDAR_ICS_URL を設定すると、本人の忙しさを iCal から計算する",
      b.known && b.busy_minutes === 900,
      b.known ? `${b.percent}%` : "不明",
    );
    delete process.env.CALENDAR_ICS_URL;
    delete process.env.DATA_SOURCE;
  }

  // ---- 繰り返しとタイムゾーン（本人のカレンダーと同じ形：TZID=Asia/Tokyo・BYDAY 複数・INTERVAL=2・UNTIL・変更された回） ----
  {
    const text = fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", "recurring.ics"), "utf-8");
    const w = windowOf(TODAY);
    const starts = parseIcs(text, new Date(w.fromMs), new Date(w.toMs))
      .map((s) => s.start.slice(0, 16))
      .sort();
    const want = [
      "2026-11-25T10:00", // America/Los_Angeles の 11/24 17:00 → 日本時間 11/25 10:00
      "2026-11-25T16:00", // 毎週 水・金 14:00 の 11/25 の回は 16:00 に変更（RECURRENCE-ID）
      "2026-11-26T13:00", // TZID="Tokyo Standard Time"（Windows の名前）
      "2026-11-30T10:00", // 隔週（INTERVAL=2）月・木。11/23 の週は休み、12/3 は UNTIL の後
      "2026-12-02T14:00", // 毎週 水・金（11/27 は EXDATE で休み）
      "2026-12-04T14:00",
    ];
    check(
      ".ics：TZID・BYDAY 複数・INTERVAL=2・UNTIL・EXDATE・変更された回・ほかのタイムゾーンを読む",
      starts.join(",") === want.join(","),
      starts.join(" / "),
    );
  }

  // ---- 取得できない・iCal でないときは「予定は不明」（推測しない） ----
  {
    process.env.DEMO_PERSON = "on";
    process.env.CALENDAR_ICS_URL = `data:text/html;base64,${Buffer.from("<html><body>Not Found</body></html>").toString("base64")}`;
    const { calendarStatus, usesIcs: uses, clearCalendarCache } = await import("../lib/busyness");
    clearCalendarCache();
    await loadCalendarIfConfigured();
    check("iCal でない中身（HTML のエラーページなど）は読み込みに失敗として扱う", calendarStatus().includes("失敗") && uses("e031") && !busynessFor("e031", TODAY).known, calendarStatus());
    delete process.env.CALENDAR_ICS_URL;
    delete process.env.DEMO_PERSON;
  }

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
