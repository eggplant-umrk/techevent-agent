// 日程が決まっていない依頼の「空いていそうな日」のテスト（APIは使わない・data/ に書き込まない）。
//   npm run test:datesuggest
// 見るもの：日程の手がかりの確かめ／手がかり → 期間／終日の予定・夜の予定・週末を除く／週をばらす／カレンダーなし・予定が分かる範囲の外／
//           受信箱に保存されて詳細に出る／主催者への返事の1文が今の検査に通り、予定の中身や埋まり具合は検査で止まる
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
  const dows = s.dates.map((d) => new Date(`${d}T00:00:00+09:00`).getDay());
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
      const w = new Date(`${d}T00:00:00+09:00`).getDay();
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

  fs.rmSync(tmp, { force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { force: true });
  process.exit(1);
});
