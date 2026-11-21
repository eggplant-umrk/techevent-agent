// 日程が決まっていない依頼の「空いていそうな日」のテスト（APIは使わない・data/ に書き込まない）。
//   npm run test:datesuggest
// 見るもの：日程の手がかりの確かめ／手がかり → 期間／終日の予定・夜の予定・週末・祝日（振替休日）・年末年始を除く／週をばらす／カレンダーなし・予定が分かる範囲の外／
//           受信箱に保存されて詳細に出る／主催者への返事の1文が今の検査に通り、予定の中身や埋まり具合は検査で止まる
import "./_isolate"; // 元のデータだけで動かす（実行時のデータ data/runtime/ は読まない・書かない）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, ProposalResult } from "../lib/agent";
import type { RawIntake } from "../lib/intake";

const tmp = path.join(os.tmpdir(), `inbox-datesuggest-${Date.now()}.json`);
process.env.INBOX_FILE = tmp;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

const T = "2026-11-21"; // アプリの「今日」（土曜）
const q = (value: string | null, quote: string | null = value) => ({ value, quote });

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  delete process.env.CALENDAR_ICS_URL;
  delete process.env.DATE_SUGGEST_START_HOUR;
  delete process.env.DATE_SUGGEST_END_HOUR;
  const { hintToPeriod, suggestDates, suggestHours, replySentence, dateLabel } = await import("../lib/dateHint");
  const { checkIntake, checkDateHint } = await import("../lib/intake");
  const { organizerReplyProblems } = await import("../lib/organizerReply");

  // ---- 手がかり → 期間（コード）
  const cases: Array<[string | null, string, string]> = [
    ["2月か3月", "2027-02-01", "2027-03-31"],
    ["２月か３月あたり", "2027-02-01", "2027-03-31"],
    ["2〜3月", "2027-02-01", "2027-03-31"],
    ["1月下旬", "2027-01-21", "2027-01-31"],
    ["12月上旬", "2026-12-01", "2026-12-10"],
    ["2月中旬ごろ", "2027-02-11", "2027-02-20"],
    ["春ごろ", "2027-03-01", "2027-05-31"],
    ["冬", "2026-12-01", "2027-02-28"],
    ["年明けあたり", "2027-01-01", "2027-01-31"],
    ["来月", "2026-12-01", "2026-12-31"],
    ["11月中", T, "2026-11-30"],
    ["10月", "2027-10-01", "2027-10-31"],
  ];
  for (const [hint, from, to] of cases) {
    const p = hintToPeriod(hint, T);
    check(`「${hint}」→ ${from}〜${to}`, p.from === from && p.to === to && p.from_hint, `${p.from}〜${p.to}（${p.label}）`);
  }
  const none = hintToPeriod("そのうち", T);
  check("分からない言い方なら今日から8週間", none.from === T && none.to === "2027-01-15" && !none.from_hint, `${none.from}〜${none.to}`);
  check("手がかりがなければ今日から8週間", hintToPeriod(null, T).to === "2027-01-15");

  // ---- 空いていそうな日（コード）
  const period = { from: "2026-12-01", to: "2026-12-31" };
  const slots = [
    { start: "2026-12-01", end: "2026-12-03", all_day: true }, // 12/1・12/2 は終日の予定
    { start: "2026-12-03T19:30:00+09:00", end: "2026-12-03T20:30:00+09:00", all_day: false }, // 12/3 は夜に予定
    { start: "2026-12-04T18:00:00+09:00", end: "2026-12-04T19:00:00+09:00", all_day: false }, // 19時ちょうどに終わるのは重ならない
  ];
  const s = suggestDates(slots, period, { hours: { start: 19, end: 21 } });
  const dows = s.dates.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay());
  check("最大3日", s.known && s.dates.length === 3, s.dates.join(","));
  check("終日の予定がある日は出さない", !s.dates.some((d) => d === "2026-12-01" || d === "2026-12-02"));
  check("19〜21時に予定がある日は出さない", !s.dates.includes("2026-12-03"));
  check("週末は出さない", dows.every((w) => w !== 0 && w !== 6), s.dates.map(dateLabel).join("・"));
  const weeks = new Set(s.dates.map((d) => Math.floor((Date.parse(`${d}T00:00:00Z`) - Date.parse("2026-11-30T00:00:00Z")) / (7 * 86_400_000))));
  check("なるべく週をばらす（3日とも別の週）", weeks.size === 3, s.dates.join(","));
  check("最初の週は、19時に終わる予定の日（12/4）が空いている扱い", s.dates[0] === "2026-12-04", s.dates[0]);
  const late = suggestDates(slots, period, { hours: { start: 18, end: 19 } });
  check("時間帯は設定で変えられる（18〜19時なら12/4は出ない）", !late.dates.includes("2026-12-04") && late.dates.includes("2026-12-03"), late.dates.join(","));
  process.env.DATE_SUGGEST_START_HOUR = "18";
  process.env.DATE_SUGGEST_END_HOUR = "20";
  check(".env の DATE_SUGGEST_START_HOUR・END_HOUR を読む", suggestHours().start === 18 && suggestHours().end === 20);
  process.env.DATE_SUGGEST_END_HOUR = "17";
  check("おかしな時間帯なら既定の19〜21時", suggestHours().start === 19 && suggestHours().end === 21);
  delete process.env.DATE_SUGGEST_START_HOUR;
  delete process.env.DATE_SUGGEST_END_HOUR;
  const nocal = suggestDates(null, period);
  check("カレンダーがない人は出さない（予定は不明）", !nocal.known && nocal.dates.length === 0 && nocal.note.includes("予定は不明"));
  const beyond = suggestDates([], { from: "2027-02-01", to: "2027-03-31" }, { knownUntil: "2026-12-31" });
  check("予定が分かる範囲より先の時期は出さない（空いているとは言えない）", beyond.known && beyond.dates.length === 0 && !!beyond.note?.includes("2026-12-31"), beyond.note ?? "");
  const half = suggestDates([], { from: "2026-12-01", to: "2027-01-31" }, { knownUntil: "2026-12-31" });
  check("期間の途中までしか分からなければ、分かる範囲だけから選ぶ", half.dates.every((d) => d <= "2026-12-31") && !!half.note?.includes("見ていません"), half.dates.join(","));
  const busy = suggestDates([{ start: "2026-12-01", end: "2027-01-01", all_day: true }], period);
  check("空いていそうな日がなければ0日と理由", busy.known && busy.dates.length === 0 && !!busy.note?.includes("見つかりませんでした"));

  // ---- 祝日・振替休日・年末年始（コードで持つ一覧）
  const { holidayName, dayOffReason, JP_HOLIDAYS } = await import("../lib/dateHint");
  const wd = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
  check("11/23（勤労感謝の日）は祝日", holidayName("2026-11-23") === "勤労感謝の日");
  const nov = suggestDates([], { from: "2026-11-23", to: "2026-11-27" }, { hours: { start: 19, end: 21 }, max: 5 });
  check("祝日（11/23）は空いていそうな日に出さない", !nov.dates.includes("2026-11-23") && nov.dates.length === 4, nov.dates.join(","));
  for (const [d, name] of [["2026-05-06", "振替休日"], ["2027-03-22", "振替休日"], ["2026-09-22", "国民の休日"]] as const) {
    check(`${d}（${name}）を除く`, holidayName(d) === name && dayOffReason(d) === name && !suggestDates([], { from: d, to: d }).dates.length);
  }
  // 一覧の打ち間違いを防ぐ：月曜の祝日は月曜、日曜の祝日の次の平日は振替休日、年は2026・2027
  const mondays = ["成人の日", "海の日", "敬老の日", "スポーツの日"];
  const all = Object.values(JP_HOLIDAYS).flatMap((y) => Object.entries(y));
  check("成人の日・海の日・敬老の日・スポーツの日はどれも月曜", all.filter(([, n]) => mondays.includes(n)).every(([d]) => wd(d) === 1) && all.filter(([, n]) => mondays.includes(n)).length === 8);
  const sundays = all.filter(([d, n]) => wd(d) === 0 && n !== "振替休日");
  const nextFree = (d: string) => {
    let x = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    while (holidayName(x) && holidayName(x) !== "振替休日") x = new Date(Date.parse(`${x}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    return x;
  };
  check("日曜の祝日のあとには振替休日がある", sundays.length > 0 && sundays.every(([d]) => holidayName(nextFree(d)) === "振替休日"), sundays.map(([d, n]) => `${d}${n}→${nextFree(d)}`).join("・"));
  check("振替休日はどれも、日曜の祝日のあと", all.filter(([, n]) => n === "振替休日").every(([d]) => sundays.some(([s]) => nextFree(s) === d)));
  check("2026年・2027年の祝日の数（18日・17日）", Object.keys(JP_HOLIDAYS[2026]).length === 18 && Object.keys(JP_HOLIDAYS[2027]).length === 17 && all.every(([d]) => JP_HOLIDAYS[Number(d.slice(0, 4))][d]));

  const ye = suggestDates([], { from: "2026-12-24", to: "2027-01-08" }, { hours: { start: 19, end: 21 }, max: 10 });
  check("年末年始（12/29〜1/3）は会社の休みとして除く", ye.dates.length > 0 && ye.dates.every((d) => d <= "2026-12-28" || d >= "2027-01-04"), ye.dates.join(","));
  const yeOn = suggestDates([], { from: "2026-12-24", to: "2027-01-08" }, { hours: { start: 19, end: 21 }, max: 10, yearEnd: false });
  check("設定で外せば、年末年始の平日（祝日でない日）も出す", yeOn.dates.includes("2026-12-29") && yeOn.dates.includes("2026-12-30") && !yeOn.dates.includes("2027-01-01"), yeOn.dates.join(","));
  process.env.DATE_SUGGEST_YEAR_END_OFF = "off";
  check(".env の DATE_SUGGEST_YEAR_END_OFF=off で年末年始を除かない", dayOffReason("2026-12-29") === null && dayOffReason("2027-01-01") === "元日");
  delete process.env.DATE_SUGGEST_YEAR_END_OFF;
  check("既定では年末年始を除く", dayOffReason("2026-12-29") === "年末年始の休み");
  const y28 = suggestDates([], { from: "2027-12-20", to: "2028-01-31" }, { hours: { start: 19, end: 21 } });
  check("一覧にない年（2028年）は、祝日を見ていないと補足する", !!y28.note?.includes("2028年の祝日は一覧にない") && !y28.note?.includes("2027年"), y28.note ?? "");
  check("一覧のある年だけなら補足は出さない", suggestDates([], { from: "2027-02-01", to: "2027-03-31" }, { hours: { start: 19, end: 21 } }).note === null);

  // ---- 日程の手がかりの読み取りの確かめ（コード）
  const conv = "@layerx_dev こんにちは！社内勉強会で登壇をお願いしたくて。時期は2月か3月で考えてます。テーマは決済まわりで🙏";
  check("会話にある言い回しなら使う", checkDateHint(conv, q("2月か3月", "時期は2月か3月で考えてます"), null) === "2月か3月");
  check("会話にない言い回しは捨てる（言い換え・推測）", checkDateHint(conv, q("春ごろ", "時期は春ごろ"), null) === null);
  check("日程が1日に決まっていれば手がかりは使わない", checkDateHint(conv, q("2月か3月"), "2027-02-10") === null);
  const raw: RawIntake = {
    event_name: q("社内勉強会"),
    date: q(null, null),
    format: q(null, null),
    theme: q("決済まわり"),
    organizer: q(null, null),
    nominee: q(null, null),
    date_hint: q("2月か3月", "時期は2月か3月で考えてます"),
  };
  const read = checkIntake(conv, raw, `${T}T10:00:00+09:00`);
  check("読み取り結果に手がかりが入る（日程は未定のまま）", read.intake.date === null && read.intake.date_hint === "2月か3月" && read.intake.undecided.includes("date"));
  const { date_hint: _omit, ...old } = raw;
  check("古い形（手がかりなし）の読み取りでも動く", checkIntake(conv, old as RawIntake, `${T}T10:00:00+09:00`).intake.date_hint === null);

  // ---- 受信箱：候補ごとに保存して、詳細に出す（架空データの予定）
  const inbox = await import("../lib/inbox");
  const { slotsFor, knownUntilFor } = await import("../lib/busyness");
  const saved = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_after.json"), "utf-8")) as { rows: Array<{ request_id: string; result: ProposalResult }> };
  const base = saved.rows.find((r) => r.request_id === "req004")!.result;
  const runner = async (request: { id: string }, emit: (e: AgentEvent) => void) => {
    emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
    return { ...base, request_id: request.id };
  };
  const decConv = "はじめまして！12月中旬ごろに LT 会をやるのですが、どなたかパフォーマンス改善の話をしていただけませんか？";
  const item = inbox.addToInbox({ text: decConv, source: "manual" }, async () => null);
  await inbox.prepare(item.id, runner, async () => ({ ...raw, event_name: q(null, null), theme: q("パフォーマンス改善の話"), format: q("LT", "LT 会"), date_hint: q("12月中旬ごろ") }));
  const got = inbox.getInboxItem(item.id)!;
  const ds = got.date_suggestions;
  check("日程が未定なら、候補ごとの空いていそうな日を保存する", !!ds && ds.candidates.length === base.candidates.length && ds.period.from === "2026-12-11" && ds.period.to === "2026-12-20", ds ? `${ds.period.label}／${ds.candidates.map((c) => `${c.name}:${c.dates.join(",")}`).join(" ")}` : "なし");
  const okDates = (ds?.candidates ?? []).every((c) => {
    const sl = slotsFor(c.employee_id) ?? [];
    return c.dates.every((d) => {
      const w = new Date(`${d}T00:00:00Z`).getUTCDay();
      const a = Date.parse(`${d}T19:00:00+09:00`);
      const b = Date.parse(`${d}T21:00:00+09:00`);
      const allDay = sl.some((x) => x.all_day && x.start <= d && d < x.end);
      const evening = sl.some((x) => !x.all_day && Date.parse(x.start) < b && Date.parse(x.end) > a);
      return w !== 0 && w !== 6 && !allDay && !evening && d >= "2026-12-11" && d <= "2026-12-20";
    });
  });
  check("出した日はどれも、平日・期間内・終日の予定なし・19〜21時に予定なし（架空データの予定で照合）", okDates);
  check("架空データの予定が分かるのは calendar.json の最後の日まで", knownUntilFor("e001") === "2026-12-31", String(knownUntilFor("e001")));
  const detail = inbox.detailView(got);
  check("受信箱の詳細の窓口に出る", JSON.stringify(detail.date_suggestions) === JSON.stringify(ds));
  check("返事の1文は材料だけ（日があれば作る）", (ds?.candidates ?? []).every((c) => (c.dates.length ? !!c.reply_sentence?.includes("本人に確認します") : c.reply_sentence === null)));

  const fixed = inbox.addToInbox({ text: "12月15日の LT 会に登壇いただけませんか", source: "manual" }, async () => null);
  await inbox.prepare(fixed.id, runner, async () => ({ ...raw, date: q("2026-12-15", "12月15日"), date_hint: q(null, null) }));
  check("日程が決まっている依頼では作らない", inbox.getInboxItem(fixed.id)!.date_suggestions === null);

  // ---- カレンダーがない人（本人 e031、iCal の設定なし）
  process.env.DEMO_PERSON = "on";
  const { buildDateSuggestions } = await import("../lib/dateSuggest");
  const me = await buildDateSuggestions(read.intake, [{ employee_id: "e031", name: "梅澤 陸" }, { employee_id: "e001", name: "架空の社員" }]);
  const c31 = me?.candidates.find((c) => c.employee_id === "e031");
  check("カレンダーがない人は「予定は不明」で日を出さない", !!c31 && !c31.known && c31.dates.length === 0 && c31.reply_sentence === null, c31?.note ?? "");
  const c01 = me?.candidates.find((c) => c.employee_id === "e001");
  check("「2月か3月」は架空データの予定が分かる範囲（12月まで）の外なので出さない", !!c01 && c01.known && c01.dates.length === 0 && !!c01.note?.includes("まだ分かりません"), c01?.note ?? "");
  delete process.env.DEMO_PERSON;

  // ---- 主催者への返事の検査（今の検査）
  const sentence = replySentence(["2026-12-14", "2026-12-17"])!;
  check("1文は「◯月◯日（曜）あたりなら調整しやすそうです（本人に確認します）。」", sentence === "12月14日（月）・12月17日（木）あたりなら調整しやすそうです（本人に確認します）。", sentence);
  const reply = `ご連絡ありがとうございます！弊社の早乙女がお力になれそうです。${sentence}`;
  check("その1文を入れた返事は、今の検査に通る", organizerReplyProblems(reply, "早乙女 蓮", ["芹沢 葵"]).length === 0, organizerReplyProblems(reply, "早乙女 蓮", ["芹沢 葵"]).join(" / "));
  for (const leak of ["12月は予定が空いているので", "スケジュールが埋まっていて", "空き状況を見ると", "12月14日は終日の予定があり、夜は空いています", "その週は出張なので", "午後に会議が入っていますが", "忙しい時期ですが"]) {
    const ps = organizerReplyProblems(`ご連絡ありがとうございます！弊社の早乙女が${leak}お力になれそうです。`, "早乙女 蓮", []);
    check(`予定の中身や埋まり具合は検査で止まる（「${leak}」）`, ps.length > 0, ps[0] ?? "通ってしまった");
  }

  // ---- 会話の中の日付を読む（docs/edge_cases.md の日付の行）----
  const { datesInText, decideDate, otherDatesInConversation } = await import("../lib/dateHint");
  const R = "2026-11-21T10:00:00+09:00";
  const dec = (q: string) => decideDate(q, R).date;
  for (const q of ["12/15", "12月15日", "2026-12-15", "2026/12/15", "2026年12月15日", "１２月１５日", "１２／１５", "2026.12.15(火)", "開催は 2026.12.15(火) です。"]) {
    check(`同じ日に読む（${q}）`, dec(q) === "2026-12-15", String(dec(q)));
  }
  for (const [q, want] of [
    ["The meetup is on February 18, 2027.", "2027-02-18"],
    ["Date: Feb. 18, 2027 (Thu)", "2027-02-18"],
    ["We'd love you to speak on 18 February 2027.", "2027-02-18"],
    ["Our event is on December 15th.", "2026-12-15"],
    ["2027年1月27日に変更になりました", "2027-01-27"],
    ["1月27日に変更になりました", "2027-01-27"],
  ] as const) {
    check(`英語の月名・年の補い（${q}）`, dec(q) === want, String(dec(q)));
  }
  for (const q of ["12月15日、16日", "12月15日と16日", "12/15・16", "12/15, 16", "12/15〜16", "12月15日〜17日", "12/15か12/16", "12月15日または16日", "December 15 or 16"]) {
    const n = datesInText(q).length;
    check(`1日に決めない（${q}）`, dec(q) === null && n >= 2, `読めた日付 ${n}件／${decideDate(q, R).reason}`);
  }
  check("「12月15日、16日」は2つの日付として数える", datesInText("12月15日、16日").map((d) => `${d.month}/${d.day}`).join(",") === "12/15,12/16");
  for (const q of ["2月30日", "2027年2月29日", "4月31日", "2026.2.30", "February 30, 2027"]) {
    const r = decideDate(q, R);
    check(`暦にない日付は決めない（${q}）`, r.date === null && /暦にない/.test(r.reason ?? ""), String(r.reason));
  }
  check("うるう年の2月29日は決める", dec("2028年2月29日") === "2028-02-29", String(dec("2028年2月29日")));
  for (const q of ["12月15日、19時から", "12/15、19:00開始", "12/15と16時", "12/15、20名", "12/15-21時", "12月15日（火）19時〜21時"]) {
    check(`時刻・人数を2つ目の日付と読まない（${q}）`, dec(q) === "2026-12-15", `${decideDate(q, R).reason}`);
  }
  for (const q of ["参加者は1-2人","倍率は1.5倍", "v2.3 のリリース", "日程は調整中です", "登壇は20分です"]) {
    check(`日付でないものを読まない（${q}）`, datesInText(q).length === 0, datesInText(q).map((d) => d.text).join("・"));
  }
  // 会話全体の別の日付
  const f4 = "開催は 2026.12.15(火) です。※チラシには12/16（水）と書いてしまいました";
  const o4 = otherDatesInConversation(f4, "開催は 2026.12.15(火) です。", "2026-12-15", R);
  check("F4：引用の外の 12/16 を返す", o4.length === 1 && o4[0].date === "2026-12-16" && o4[0].before_quote === false, JSON.stringify(o4));
  const n2 = "日程は1月20日を候補にしていましたが、会場の都合で 1月27日 に変更になりました。";
  const o2 = otherDatesInConversation(n2, "1月27日 に変更になりました", "2027-01-27", R);
  check("N2：引用より前の候補日 1月20日 を返す（前か後かが分かる）", o2.length === 1 && o2[0].date === "2027-01-20" && o2[0].before_quote === true, JSON.stringify(o2));
  // 空白の入り方が違う引用（読み取りの照合と同じく、NFKC にそろえて空白を無視して探す）
  const sp = "日程は1月20日を候補にしていましたが、会場の都合で\n1月 27日に変更に　なりました。\n懇親会は1月28日です。";
  for (const q of ["1月27日に変更になりました", "1月 27 日 に 変更に なりました", "１月２７日に変更になりました"]) {
    const os = otherDatesInConversation(sp, q, "2027-01-27", R);
    const by = Object.fromEntries(os.map((o) => [o.date, o.before_quote]));
    check(`空白の入り方が違う引用でも位置が分かる（「${q.replace(/\n/g, "⏎")}」）`, os.length === 2 && by["2027-01-20"] === true && by["2027-01-28"] === false, JSON.stringify(os));
  }
  check("引用が会話にないときは、どの日付も引用の前とはしない", otherDatesInConversation(sp, "2月3日に変更", "2027-02-03", R).every((o) => o.before_quote === false));
  const one = "開催は12月15日（火）です。当日は12/15の19時からです。";
  check("同じ日を言い直しただけなら別の日付はない", otherDatesInConversation(one, "開催は12月15日（火）です。", "2026-12-15", R).length === 0);
  check("暦にない日付は別の日付に数えない", otherDatesInConversation("開催は12月15日です。2月30日は休み", "開催は12月15日です。", "2026-12-15", R).length === 0);

  fs.rmSync(tmp, { force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { force: true });
  process.exit(1);
});
