// デモ用の31人目（開発者本人、DEMO_PERSON=on）のテスト（APIは使わない・data/ に書き込まない）。
//   npm run test:demo
import "./_isolate"; // 元のデータだけで動かす（実行時のデータ data/runtime/ は読まない・書かない）
import fs from "node:fs";
import path from "node:path";
import { activities, employees } from "../lib/data";
import { loadCards } from "../lib/cards";
import { busynessFor, busyText, loadCalendarIfConfigured } from "../lib/busyness";
import { pendingEmployees } from "../lib/notebook";
import { talkTag } from "../lib/talkTag";
import { DEMO_ID } from "../lib/demoPerson";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.CALENDAR_ICS_URL;
  const github = JSON.parse(fs.readFileSync(path.join("data", "sources", "github", "activities.json"), "utf-8")) as Array<{ id: string; title: string; url?: string }>;

  // ---- 既定：架空の30人だけ ----
  delete process.env.DEMO_PERSON;
  const baseEmp = employees();
  const baseActs = activities();
  const baseCards = loadCards();
  check("既定：社員は30人で、本人はいない", baseEmp.length === 30 && !baseEmp.some((e) => e.id === DEMO_ID), `${baseEmp.length}人`);

  // ---- DEMO_PERSON=on：本人が31人目 ----
  process.env.DEMO_PERSON = "on";
  const emp = employees();
  const me = emp.find((e) => e.id === DEMO_ID);
  check("DEMO_PERSON=on：社員は31人、31人目が本人（e031）", emp.length === 31 && !!me && emp.slice(0, 30).every((e, i) => e.id === baseEmp[i].id), me ? `${me.id} ${me.name}` : "なし");
  check("本人の id は架空の社員とぶつからない", new Set(emp.map((e) => e.id)).size === emp.length);
  check("本人の登壇回数は0で「初登壇」の印", !!me && me.past_talk_count === 0 && me.last_talk_date === null && talkTag(me) === "初登壇");
  check("決め打ちの忙しさ（workload）は持たない", !!me && !("workload" in me));

  const acts = activities();
  // GitHub から取り込んだ本人の活動（Slack の #share から読んだ本人の投稿は種類 slack なので除く）
  const mine = acts.filter((a) => a.author_id === DEMO_ID && a.type !== "slack" && a.type !== "blog");
  check("本人の活動は GitHub の本物の活動そのまま（件数・タイトル・URL）", mine.length === github.length && mine.every((a, i) => a.title === github[i].title && a.url === github[i].url), `${mine.length}件`);
  check("活動の id は架空の活動とぶつからない（act201〜）", new Set(acts.map((a) => a.id)).size === acts.length && mine.every((a) => Number(a.id.slice(3)) > 200), `${mine[0]?.id}〜${mine.at(-1)?.id}`);
  check("架空の30人の活動は変わらない", JSON.stringify(acts.filter((a) => a.author_id !== DEMO_ID)) === JSON.stringify(baseActs));
  check("架空の30人のカードは変わらない（本人のカードは別のファイル）", JSON.stringify(loadCards().filter((c) => c.employee_id !== DEMO_ID)) === JSON.stringify(baseCards));
  check("ネタ帳の更新が要るのは本人だけ（架空の30人の更新状態はそのまま）", (() => {
    const p = pendingEmployees();
    return p.includes(DEMO_ID) || loadCards().some((c) => c.employee_id === DEMO_ID);
  })(), pendingEmployees().join(","));

  // ---- 予定 ----
  await loadCalendarIfConfigured();
  const unknown = busynessFor(DEMO_ID);
  check("CALENDAR_ICS_URL がなければ本人は「予定は不明」", !unknown.known && busyText(unknown) === "予定は不明");
  const e012 = busynessFor("e012");
  check("架空の社員の予定は今までどおり（e012 は余裕あり）", e012.known && e012.level === "余裕あり");

  const ics = fs.readFileSync(path.join("scripts", "fixtures", "sample.ics"), "utf-8");
  process.env.CALENDAR_ICS_URL = `data:text/calendar;base64,${Buffer.from(ics).toString("base64")}`;
  await loadCalendarIfConfigured();
  const known = busynessFor(DEMO_ID, "2026-11-21");
  check("CALENDAR_ICS_URL があれば本人の忙しさを iCal から計算する", known.known && known.busy_minutes === 900, known.known ? `${known.percent}%` : "不明");
  const e012b = busynessFor("e012");
  check("iCal は本人にだけ使い、架空の社員には使わない", e012b.known && e012.known && e012b.percent === e012.percent);
  delete process.env.CALENDAR_ICS_URL;

  // ---- 併用しない ----
  process.env.DATA_SOURCE = "github";
  let threw = false;
  try {
    employees();
  } catch {
    threw = true;
  }
  check("DATA_SOURCE=github と同時には使えない（止める）", threw);
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
