import "./_isolate"; // 元のデータだけで動かす。「今日」は 2026-11-21 に固定
// 主催者への返事・声かけの下書きに入る日程の形（lib/dateText.ts）のテスト。API は使わない。
//   npm run test:replydate   （npm test にも入る）
// - 日程は「1月19日（火）」の形。年が今年と違うときだけ「2027年1月19日（火）」。曜日はコードで出す
// - AI が「2027-01-19」の形や違う曜日で書いても、コードが直す（作り直さない）
import type { SpeakingRequest } from "../lib/data";
import { EDGE_CASES } from "./fixtures/edge_cases";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}
const byId = (id: string) => EDGE_CASES.find((c) => c.id === id)!;
const RECEIVED = "2026-11-21T10:00:00+09:00";

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  const { displayDate, fixEventDateText } = await import("../lib/dateText");
  const { checkIntake } = await import("../lib/intake");
  const inbox = await import("../lib/inbox");
  const { organizerReplyFacts, draftOrganizerReply, withEventDate } = await import("../lib/heavy");
  const { employees, requests } = await import("../lib/data");

  // ---- 1. 形（今日は 2026-11-21）
  check("今年の日付は年なし：12月10日（木）", displayDate("2026-12-10") === "12月10日（木）", displayDate("2026-12-10"));
  check("年が今年と違うときだけ年つき：2027年1月19日（火）", displayDate("2027-01-19") === "2027年1月19日（火）", displayDate("2027-01-19"));
  check("今日の年を渡せば、それに合わせる（2027年に見れば年なし）", displayDate("2027-01-19", "2027-01-05") === "1月19日（火）" && displayDate("2026-12-10", "2027-01-05") === "2026年12月10日（木）");
  const dows: Array<[string, string]> = [["2026-11-22", "日"], ["2026-11-23", "月"], ["2026-11-24", "火"], ["2026-11-25", "水"], ["2026-11-26", "木"], ["2026-11-27", "金"], ["2026-11-28", "土"]];
  check("曜日は7つとも合う（11/22 は日曜）", dows.every(([d, w]) => displayDate(d).endsWith(`（${w}）`)), dows.map(([d]) => displayDate(d)).join(" "));
  check("うるう日・月の頭の 0 を落とす：2028年2月29日（火）・2027年3月3日（水）", displayDate("2028-02-29") === "2028年2月29日（火）" && displayDate("2027-03-03") === "2027年3月3日（水）");
  check("日付でないもの・暦にない日付・空は、そのまま返す（作らない）", displayDate("未定") === "未定" && displayDate("2027-02-30") === "2027-02-30" && displayDate(null) === "" && displayDate("") === "");
  // 曜日は実行する場所の時刻帯に左右されない（UTC で数える）
  const all2027 = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2027, 0, 1 + i)).toISOString().slice(0, 10));
  check("2027年の365日すべてで、曜日が暦と合う", all2027.every((d) => displayDate(d).slice(-2, -1) === "日月火水木金土"[new Date(`${d}T12:00:00Z`).getUTCDay()]));

  // ---- 2. 返事を作る AI に渡す「確かめた項目」
  const who = employees().find((e) => e.name === "百瀬 結衣")!;
  const cand = { employee_id: who.id, name: who.name, theme: "初期表示を1.8秒縮めたバンドル改善" };
  const requestOf = (id: string): SpeakingRequest => {
    const r = checkIntake(byId(id).text, byId(id).raw!, RECEIVED);
    return inbox.inboxRequest({ id: `inb-${id}`, text: byId(id).text, received_at: RECEIVED, source: "manual", nominee: r.nominee, intake: r.intake });
  };
  const line = (facts: string) => facts.split("\n").find((l) => l.startsWith("日程：")) ?? "";
  const a1 = requestOf("A1");
  const facts1 = organizerReplyFacts(a1, cand);
  check("[A1] 渡す日程は「2027年1月19日（火）」（2027-01-19 の形は渡さない）", line(facts1) === "日程：2027年1月19日（火）" && !facts1.includes("2027-01-19"), line(facts1));
  check("[N1] 今年の日程は年なし「12月10日（木）」", line(organizerReplyFacts(requestOf("N1"), cand)) === "日程：12月10日（木）");
  check("[N4] 日程が未定なら「未定」のまま", line(organizerReplyFacts(requestOf("N4"), cand)) === "日程：未定");
  const sample = requests()[0];
  const sampleLine = line(organizerReplyFacts(sample, cand));
  check("サンプルの依頼も同じ形", sampleLine === `日程：${displayDate(sample.event!.date)}` && /^日程：(\d{4}年)?\d{1,2}月\d{1,2}日（[日月火水木金土]）$/.test(sampleLine), sampleLine);

  // ---- 3. AI が書いた文の中の開催日を、コードで直す
  const iso = "2027-01-19";
  const fx = (t: string) => fixEventDateText(t, iso);
  check("「2027-01-19」→「2027年1月19日（火）」", fx("Infra Study Tokyo #9（2027-01-19）での登壇") === "Infra Study Tokyo #9（2027年1月19日（火））での登壇", fx("Infra Study Tokyo #9（2027-01-19）での登壇"));
  check("「2027/1/19」「2027.01.19」も直す", fx("2027/1/19 の件") === "2027年1月19日（火） の件" && fx("2027.01.19の件") === "2027年1月19日（火）の件");
  check("数字の形に曜日が付いていれば、まとめて置き換える（曜日を重ねない）", fx("2027-01-19（火）の件") === "2027年1月19日（火）の件" && fx("2027-01-19(水)の件") === "2027年1月19日（火）の件");
  check("違う曜日「1月19日（水）」→「1月19日（火）」", fx("1月19日（水）19時〜のLT") === "1月19日（火）19時〜のLT" && fx("1月19日(水曜)のLT") === "1月19日(火曜)のLT", fx("1月19日(水曜)のLT"));
  check("合っている文は変えない", fx("1月19日（火）のLT、弊社の百瀬が") === "1月19日（火）のLT、弊社の百瀬が" && fx("2027年1月19日（火）") === "2027年1月19日（火）");
  check("開催日でない日付には触らない（別の日・別の年・11月19日・21月19日）", fx("2027-01-20 と 2026-01-19 と 11月19日（水）と 12027-01-19") === "2027-01-20 と 2026-01-19 と 11月19日（水）と 12027-01-19", fx("2027-01-20 と 2026-01-19 と 11月19日（水）と 12027-01-19"));
  check("日程が未定・日付でないときは何もしない", fixEventDateText("2027-01-19 の件", null) === "2027-01-19 の件" && fixEventDateText("2027-01-19 の件", "未定") === "2027-01-19 の件");

  // ---- 4. 主催者への返事：AI が数字の形・違う曜日で書いても、作り直さずに直る（モデルは偽物）
  const fake = (reply: string) => {
    let calls = 0;
    const call = async () => {
      calls++;
      return { text: JSON.stringify({ organizer_reply: reply }), model: "fake", cost: 0 };
    };
    return { call, calls: () => calls };
  };
  const tail = "弊社の百瀬がお力になれそうです。本人に確認して、あらためてご連絡します。あわせて、謝礼・交通費の有無と、お返事の期限を教えていただけますと幸いです。";
  const f1 = fake(`西村さん、Infra Study Tokyo #9（2027-01-19）のお声がけをありがとうございます。${tail}`);
  const r1 = await draftOrganizerReply("test", a1, cand, f1.call);
  check("[A1] 返事の「2027-01-19」は「2027年1月19日（火）」に直り、作り直しも差し替えもしない", r1.reply.includes("（2027年1月19日（火））") && !r1.reply.includes("2027-01-19") && r1.note === null && f1.calls() === 1, r1.note ?? r1.reply);
  const f2 = fake(`西村さん、1月19日（水）のInfra Study Tokyo #9のお声がけをありがとうございます。${tail}`);
  const r2 = await draftOrganizerReply("test", a1, cand, f2.call);
  check("[A1] 返事の曜日が違っていたら、正しい曜日に直る（1回で通る）", r2.reply.includes("1月19日（火）") && !r2.reply.includes("（水）") && r2.note === null && f2.calls() === 1, r2.note ?? r2.reply);
  const f3 = fake(`西村さん、2027年1月19日（火）のInfra Study Tokyo #9のお声がけをありがとうございます。${tail}`);
  const r3 = await draftOrganizerReply("test", a1, cand, f3.call);
  check("[A1] 渡した形のまま書いた返事は、そのまま通る", r3.reply.startsWith("西村さん、2027年1月19日（火）の") && r3.note === null && f3.calls() === 1, r3.note ?? "");
  const fb = await draftOrganizerReply("test", a1, cand, fake("").call);
  check("[A1] 決まった文（差し替え）には、数字だけの形の日付が出ない", !!fb.note && !/\d{4}-\d{2}-\d{2}/.test(fb.reply), fb.reply);

  // ---- 5. 声かけの下書き：開催日を同じ形に直す（コード。モデルは呼ばない）
  const draft = { subject: "【ご相談】2027-01-19 のLT登壇について", message: "百瀬さん、2027-01-19 に五反田で開かれる会です。1月19日（月）の夜です。", lt_outline: [], tips_for_pr: ["2027/01/19 の予定を先に確認"] };
  const fixed = withEventDate(draft, iso);
  check("件名・声かけ文・声をかける前に、の開催日が「2027年1月19日（火）」になり、違う曜日も直る", fixed.subject === "【ご相談】2027年1月19日（火） のLT登壇について" && fixed.message === "百瀬さん、2027年1月19日（火） に五反田で開かれる会です。1月19日（火）の夜です。" && fixed.tips_for_pr[0] === "2027年1月19日（火） の予定を先に確認", JSON.stringify(fixed));
  check("日程が未定なら、下書きは変えない", withEventDate(draft, null) === draft);

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
