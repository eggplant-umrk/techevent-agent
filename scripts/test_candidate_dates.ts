// 開催日の候補が会話に2〜4日書いてあるときの「候補日ごとの都合」のテスト（AI・API は使わない・data/ に書き込まない）。
//   npx tsx scripts/test_candidate_dates.ts
// 見るもの：会話から候補日を読む／候補日ごとの都合（○・×（終日の予定）・×（夜に予定）・?）／○が1つ・0・全部／予定が分からない人・カレンダーが読めないとき／
//           返事の1文（○の日・「ご提示の日程が難しく…」）／注意点の文／聞き返す項目から日程を外す／Agent に渡す注意／
//           受信箱に保存され、候補の注意点に入る（候補から外さない）／本人（DEMO_PERSON）の12/14〜18の終日の予定で 12/15・12/17 が×、1/14 が○
import "./_isolate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, ProposalResult } from "../lib/agent";
import type { RawIntake } from "../lib/intake";
import type { BusySlot } from "../lib/ics";

process.env.INBOX_FILE = path.join(os.tmpdir(), `inbox-candidate-dates-${Date.now()}.json`);

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}
const q = (value: string | null, quote: string | null = value) => ({ value, quote });
const RECEIVED = "2026-11-21T10:00:00+09:00";
const CONV = [
  "@hayami_frontend",
  "LayerXさん、はじめまして！「Frontend Perf Night #4」を運営している早見です。Next.js での表示速度の改善事例をLTでお話しいただける方を探しています🙏",
  "",
  "@hayami_frontend",
  "日程は 12月15日（火）・12月17日（木）・1月14日（木）のどれかで考えています。いずれも19時から渋谷、現地のみ、LTは10分です。参加は40名ほどの予定です。",
  "",
  "@LayerX_tech",
  "ご連絡ありがとうございます！社内で話せそうな人に確認してみますね。",
].join("\n");
const DAYS = ["2026-12-15", "2026-12-17", "2027-01-14"];

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  delete process.env.CALENDAR_ICS_URL;
  delete process.env.DATE_SUGGEST_START_HOUR;
  delete process.env.DATE_SUGGEST_END_HOUR;
  const dh = await import("../lib/dateHint");

  // ---- 1. 会話から候補日を読む
  console.log("\n━ 1. 会話から候補日を読む");
  check("例の会話から3日（年つき・日付の順）", JSON.stringify(dh.candidateDatesIn(CONV, RECEIVED)) === JSON.stringify(DAYS), JSON.stringify(dh.candidateDatesIn(CONV, RECEIVED)));
  check("「12月15日（火）・17日（木）・1月14日（木）」（月を省いた日が曜日のあとに続く）も3日", JSON.stringify(dh.candidateDatesIn("12月15日（火）・17日（木）・1月14日（木）のどれかでお願いします", RECEIVED)) === JSON.stringify(DAYS), JSON.stringify(dh.candidateDatesIn("12月15日（火）・17日（木）・1月14日（木）のどれかでお願いします", RECEIVED)));
  check("1日だけなら候補日にしない", dh.candidateDatesIn("12月17日（木）19時からオンラインです", RECEIVED) === null);
  check("5日以上なら候補日にしない", dh.candidateDatesIn("12/1・12/2・12/3・12/4・12/5 のどれか", RECEIVED) === null);
  check("期間（〜）は候補日にしない", dh.candidateDatesIn("12月15日〜17日のどこかで", RECEIVED) === null);
  check("「12/15、19時から」の19は日付にしない（12/15 と 1/14 の2日）", JSON.stringify(dh.candidateDatesIn("12/15、19時から。予備日は1/14", RECEIVED)) === JSON.stringify(["2026-12-15", "2027-01-14"]));

  // ---- 2. 候補日ごとの都合（コード）
  console.log("\n━ 2. 候補日ごとの都合");
  const allDay = (from: string, toExclusive: string): BusySlot => ({ start: from, end: toExclusive, all_day: true }) as BusySlot;
  const evening = (date: string): BusySlot => ({ start: `${date}T19:30:00+09:00`, end: `${date}T20:30:00+09:00`, all_day: false }) as BusySlot;
  const morning = (date: string): BusySlot => ({ start: `${date}T10:00:00+09:00`, end: `${date}T11:00:00+09:00`, all_day: false }) as BusySlot;
  const slots = [allDay("2026-12-15", "2026-12-16"), evening("2026-12-17"), morning("2027-01-14")];
  const marks = DAYS.map((d) => dh.dayAvailability(slots, d, { knownUntil: "2027-05-31" }));
  check("終日の予定 → ×（終日の予定）・夜の予定 → ×（夜に予定）・昼だけの予定 → ○", JSON.stringify(marks) === JSON.stringify(["all_day", "evening", "ok"]), marks.join(","));
  check("記号は ×（終日の予定）・×（夜に予定）・○・?", [...marks.map((m) => dh.DAY_MARK_LABEL[m]), dh.DAY_MARK_LABEL.unknown].join(" ") === "×（終日の予定） ×（夜に予定） ○ ?");
  check("カレンダーがない人は ?", dh.dayAvailability(null, "2026-12-15") === "unknown");
  check("予定が分かる範囲より先の日は ?", dh.dayAvailability(slots, "2027-01-14", { knownUntil: "2026-12-31" }) === "unknown");
  const days = (ms: string[]) => DAYS.map((date, i) => ({ date, mark: ms[i] as import("../lib/dateHint").DayMark }));
  // ○が1つ
  const one = days(["all_day", "evening", "ok"]);
  check("○が1つ：返事の1文は「1月14日（木）でしたら調整しやすそうです（本人に確認します）。」", dh.candidateDatesReply(one) === "1月14日（木）でしたら調整しやすそうです（本人に確認します）。", String(dh.candidateDatesReply(one)));
  check("○が1つ：注意点は「候補日のうち 1/14 だけ都合がよい」", dh.candidateDatesNote(one) === "候補日のうち 1/14 だけ都合がよい", String(dh.candidateDatesNote(one)));
  check("○が1つ：カードの1行「12/15 × ・12/17 × ・1/14 ○」", dh.candidateDaysLine(one) === "12/15 × ・12/17 × ・1/14 ○", dh.candidateDaysLine(one));
  // ○が0
  const none = days(["all_day", "all_day", "evening"]);
  check("○が0：返事の1文は「ご提示の日程が難しく、別の日をご相談できればと思います。」", dh.candidateDatesReply(none) === "ご提示の日程が難しく、別の日をご相談できればと思います。", String(dh.candidateDatesReply(none)));
  check("○が0：注意点は「候補日はどれも予定が合わない」", !!dh.candidateDatesNote(none)?.startsWith("候補日はどれも予定が合わない"), String(dh.candidateDatesNote(none)));
  // 全部○
  const all = days(["ok", "ok", "ok"]);
  check("全部○：返事の1文は3日を並べる", dh.candidateDatesReply(all) === "12月15日（火）・12月17日（木）・1月14日（木）でしたら調整しやすそうです（本人に確認します）。", String(dh.candidateDatesReply(all)));
  check("全部○：注意点は「候補日はどれも都合がよさそう」", !!dh.candidateDatesNote(all)?.startsWith("候補日はどれも都合がよさそう"));
  // 予定が分からない
  const unk = days(["unknown", "unknown", "unknown"]);
  check("予定が分からない人：返事の1文は作らない（null）", dh.candidateDatesReply(unk) === null);
  check("予定が分からない人：注意点は「候補日の予定は不明」", !!dh.candidateDatesNote(unk)?.startsWith("候補日の予定は不明"));
  check("○がなく ? がある人：断る1文は作らない（本人に確かめる前に断らない）", dh.candidateDatesReply(days(["all_day", "unknown", "evening"])) === null);
  check("○と ? がまざる人：○の日だけを書き、? の日は分からないと書く", dh.candidateDatesNote(days(["ok", "unknown", "evening"])) === "候補日のうち 12/15 だけ都合がよい（12/17 は予定が分からない）", String(dh.candidateDatesNote(days(["ok", "unknown", "evening"]))));
  check("予定の題名は文に出さない（決まった言葉だけ）", ![one, none, all, unk].some((d) => /会議|出張|休暇/.test(`${dh.candidateDatesReply(d)}${dh.candidateDatesNote(d)}`)));

  // ---- 3. 聞き返す項目から日程を外す（lib/askBack.ts）
  console.log("\n━ 3. 聞き返す項目");
  const { checkIntake } = await import("../lib/intake");
  const { requestItems, askBack } = await import("../lib/askBack");
  const inbox = await import("../lib/inbox");
  const raw: RawIntake = {
    event_name: q("Frontend Perf Night #4"),
    date: q(null, null),
    format: q("LT", "LTでお話し"),
    theme: q("Next.js での表示速度の改善事例"),
    organizer: q("早見"),
    nominee: q(null, null),
    date_hint: q(null, null),
  };
  const read = checkIntake(CONV, raw, RECEIVED);
  const req = inbox.inboxRequest({ id: "inb-test-dates", text: CONV, received_at: RECEIVED, source: "manual", intake: read.intake });
  check("依頼に候補日の一覧を持たせる", JSON.stringify(req.candidate_dates) === JSON.stringify(DAYS), JSON.stringify(req.candidate_dates));
  const items = requestItems(req);
  check("日程は「候補日：12/15・12/17・1/14」（未定にしない）", items.find((i) => i.key === "date")?.value === "候補日：12/15・12/17・1/14", String(items.find((i) => i.key === "date")?.value));
  check("聞き返す項目に日程が入らない", !askBack(items).some((i) => i.key === "date"), askBack(items).map((i) => i.label).join("・"));
  const noDates = inbox.inboxRequest({ id: "inb-test-nodates", text: "12月中旬ごろに LT 会をやります。登壇をお願いできませんか", received_at: RECEIVED, source: "manual", intake: read.intake });
  const fixedRead = { ...read.intake, date: "2026-12-17" };
  check("日程が1日に決まっている依頼は、候補日として扱わない", inbox.inboxRequest({ id: "inb-test-fixed", text: CONV, received_at: RECEIVED, source: "manual", intake: fixedRead }).candidate_dates === undefined);
  check("候補日がない依頼は今までどおり（日程は未定として聞き返す）", noDates.candidate_dates === undefined && askBack(requestItems(noDates)).some((i) => i.key === "date"));

  // ---- 4. Agent に渡す注意（コードで作った文）
  console.log("\n━ 4. Agent に渡す注意");
  check("読み取った項目は先頭のまま、【元の会話】の直前に候補日と「候補から外さず、注意点に書く」の注意が入る", req.message.startsWith("【会話から読み取った項目") && /【開催日の候補[^]*【元の会話】/.test(req.message) && req.message.includes("12月15日（火）・12月17日（木）・1月14日（木）") && req.message.includes("候補から外さず") && req.message.includes("注意点に書く"));
  check("読み取った項目と元の会話はそのまま続く", req.message.includes("【会話から読み取った項目") && req.message.includes("【元の会話】") && req.message.endsWith(CONV));

  // ---- 5. 受信箱：候補日ごとの都合が保存され、候補の注意点に入る（本人の iCal：12/14〜18 に終日の予定）
  // ---- 4b. コードが足す注意点（lib/proposalPrep.ts の computedCautions）
  const { computedCautions } = await import("../lib/proposalPrep");
  const UNDECIDED = "日程が未定なので、予定が重ならないかは日程が決まったら確認";
  check("候補日の一覧がある依頼では、「日程が未定なので…」を足さない", !computedCautions("e001", req, null).includes(UNDECIDED), computedCautions("e001", req, null).join(" / "));
  check("候補日がなく日程が未定の依頼では、今までどおり「日程が未定なので…」を足す", computedCautions("e001", noDates, null).includes(UNDECIDED), computedCautions("e001", noDates, null).join(" / "));

  console.log("\n━ 5. 受信箱と本人の予定（DEMO_PERSON）");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:test-demo-person-1214",
    "DTSTART;VALUE=DATE:20261214",
    "DTEND;VALUE=DATE:20261219",
    "SUMMARY:テストの終日の予定",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  process.env.DEMO_PERSON = "on";
  process.env.CALENDAR_ICS_URL = `data:text/calendar;base64,${Buffer.from(ics).toString("base64")}`;
  const busy = await import("../lib/busyness");
  busy.clearCalendarCache({ files: true });
  const saved = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_after.json"), "utf-8")) as { rows: Array<{ request_id: string; result: ProposalResult }> };
  const sample = saved.rows.find((r) => r.request_id === "req004")!.result;
  const proto = sample.candidates[0];
  const base: ProposalResult = {
    ...sample,
    candidates: [
      { ...proto, employee_id: "e031", name: "梅澤 陸", cautions: [] },
      { ...proto, employee_id: sample.candidates[1]?.employee_id ?? "e001", name: sample.candidates[1]?.name ?? "架空の社員", cautions: [] },
    ],
  };
  let seenMessage = "";
  const runner = async (request: { id: string; message: string }, emit: (e: AgentEvent) => void) => {
    seenMessage = request.message;
    emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
    return { ...base, request_id: request.id };
  };
  const item = inbox.addToInbox({ text: CONV, source: "manual" }, async () => null);
  await inbox.prepare(item.id, runner, async () => raw);
  const got = inbox.getInboxItem(item.id)!;
  const ds = got.date_suggestions;
  check("Agent に渡した依頼文に、候補日の注意が入っている", seenMessage.includes("【開催日の候補") && seenMessage.includes("候補から外さず"));
  check("受信箱に候補日の一覧が保存される", JSON.stringify(ds?.candidate_dates) === JSON.stringify(DAYS), JSON.stringify(ds?.candidate_dates));
  const me = ds?.candidates.find((c) => c.employee_id === "e031");
  const meMarks = (me?.candidate_days ?? []).map((d) => `${d.date}:${d.mark}`).join(" ");
  check("本人：12/15・12/17 は ×（終日の予定）、1/14 は ○", meMarks === "2026-12-15:all_day 2026-12-17:all_day 2027-01-14:ok", meMarks);
  check("本人：空いていそうな日は候補日の中の○の日（1/14 だけ）", JSON.stringify(me?.dates) === JSON.stringify(["2027-01-14"]));
  check("本人：返事の1文は「1月14日（木）でしたら調整しやすそうです（本人に確認します）。」", me?.reply_sentence === "1月14日（木）でしたら調整しやすそうです（本人に確認します）。", String(me?.reply_sentence));
  const meCand = got.result?.candidates.find((c) => c.employee_id === "e031");
  check("本人：候補から外さず、注意点に「候補日のうち 1/14 だけ都合がよい」が入る", !!meCand && meCand.cautions.includes("候補日のうち 1/14 だけ都合がよい"), (meCand?.cautions ?? []).join(" / "));
  check("候補日の注意は注意点の先頭（たたまれずに見える）", meCand?.cautions[0] === "候補日のうち 1/14 だけ都合がよい");
  check("候補日があるときは、未定の注意に日程を入れない", !(meCand?.cautions ?? []).some((t) => /日程.*未定です/.test(t)), (meCand?.cautions ?? []).join(" / "));
  check("予定の題名は保存されない", !JSON.stringify(got).includes("テストの終日の予定"));
  const detail = inbox.detailView(got);
  check("受信箱の詳細の窓口に候補日の都合が出る", JSON.stringify(detail.date_suggestions?.candidate_dates) === JSON.stringify(DAYS));

  // カレンダーが読めないとき：本人は ?（予定が分からない）、ほかの人の判定と候補は続く
  process.env.CALENDAR_ICS_URL = `data:text/html;base64,${Buffer.from("<html><body>Not Found</body></html>").toString("base64")}`;
  busy.clearCalendarCache({ files: true });
  const { buildDateSuggestions } = await import("../lib/dateSuggest");
  const broken = await buildDateSuggestions(read.intake, [{ employee_id: "e031", name: "梅澤 陸" }, { employee_id: "e001", name: "架空の社員" }], undefined, DAYS);
  const b31 = broken?.candidates.find((c) => c.employee_id === "e031");
  check("カレンダーが読めないとき：本人の候補日は全部 ?・返事の1文は作らない", !!b31 && (b31.candidate_days ?? []).every((d) => d.mark === "unknown") && b31.reply_sentence === null && !b31.known, (b31?.candidate_days ?? []).map((d) => d.mark).join(","));
  const b01 = broken?.candidates.find((c) => c.employee_id === "e001");
  check("カレンダーが読めないとき：ほかの人（架空データの予定）は判定が続く", !!b01 && (b01.candidate_days ?? []).some((d) => d.mark !== "unknown"), (b01?.candidate_days ?? []).map((d) => d.mark).join(","));
  delete process.env.CALENDAR_ICS_URL;
  delete process.env.DEMO_PERSON;
  busy.clearCalendarCache({ files: true });
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    console.log(failed ? `\n${failed}件 不合格` : "\nすべて合格");
    process.exit(failed ? 1 : 0);
  });
