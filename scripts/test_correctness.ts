import "./_isolate"; // 元のデータだけで動かす（今日は FIXED_TODAY=2026-11-21）
// 日付・受信箱の依頼・根拠の検査の直しのテスト（APIは使わない）。
//   npm run test:correct
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

const inboxFile = path.join(os.tmpdir(), `inbox-correct-${process.pid}.json`);
process.env.INBOX_FILE = inboxFile;

async function main() {
  const clock = await import("../lib/clock");
  const { eventDateOf, requests } = await import("../lib/data");
  const { validateSubmit, cautionDateProblems } = await import("../lib/agent");
  const { validateCardInput } = await import("../lib/cards");
  const inbox = await import("../lib/inbox");
  const { resolveRequest } = await import("../lib/requests");

  // ---- 1. 今日（日本時間）
  check("評価・テストでは FIXED_TODAY の日付", clock.todayJst() === "2026-11-21");
  const fixed = process.env.FIXED_TODAY;
  delete process.env.FIXED_TODAY;
  const real = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  check("ふだんは日本時間の実際の日付", clock.todayJst() === real, clock.todayJst());
  process.env.FIXED_TODAY = fixed;
  check("記録する日時は日本時間（+09:00）", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/.test(clock.nowJst()) && Math.abs(Date.parse(clock.nowJst()) - Date.now()) < 5000, clock.nowJst());
  check("前の記録（…Z）と新しい記録（+09:00）が混ざっても、時刻で正しく並ぶ", ["2026-11-21T10:00:00.000Z", "2026-11-21T18:30:00.000+09:00"].sort(clock.byTimeDesc)[0] === "2026-11-21T10:00:00.000Z");

  // ---- 2. 受信箱の依頼の開催日
  const t0 = new Date().toISOString();
  const item = {
    id: "inb-test-0001",
    source: "manual",
    meta: null,
    text: "1月28日のWeb Performance Nightで、笹倉さんに登壇をお願いしたいです",
    received_at: t0,
    status: "ready",
    started_at: t0,
    finished_at: t0,
    error: null,
    opened_at: null,
    nominee: { name: "笹倉 由紀", employee_id: "e002", note: null },
    intake: { event_name: "Web Performance Night", date: "2027-01-28", format: null, theme: null, organizer: null, reasons: {} },
    result: null,
    events: [],
    run_usd: 0,
  };
  fs.writeFileSync(inboxFile, JSON.stringify([item]));
  const req = resolveRequest({ request_id: item.id })!;
  check("受信箱の依頼の開催日は、会話から確かめた日程", eventDateOf(req) === "2027-01-28");
  check("サンプルの依頼の開催日は event.date", eventDateOf(requests()[0]) === requests()[0].event?.date);
  check("日程が決まっていなければ null", eventDateOf({ intake: { date: null } } as never) === null);
  const wrong = cautionDateProblems(req, [{ employee_id: "e012", cautions: ["開催日 2027-02-18 は予定が空いている"], caveat: null }]);
  check("受信箱の依頼でも、開催日と食い違う注意点を見つける", wrong.length > 0, wrong[0]);
  const right = cautionDateProblems(req, [{ employee_id: "e012", cautions: ["開催日 2027-01-28 は予定が空いている"], caveat: null }]);
  check("開催日と合う注意点は通す", right.length === 0, right.join(" / "));

  // ---- 3. 受信箱の指名の依頼で、カードのない本人を承認する（根拠は依頼）
  const nomineeCard = {
    card_id: null,
    employee_id: "e002",
    summary: "指名の依頼から作ったカード",
    themes: ["Web Performance Night での登壇"],
    evidence_activity_ids: [],
    format: "lt" as const,
    format_reason: "指名の依頼から作成したカード（根拠は依頼そのもの）",
    published_ids: [],
    announcement_activity_ids: [],
    evidence_request_ids: [item.id],
  };
  const errs = validateCardInput(nomineeCard);
  check("受信箱の依頼を根拠に、指名された本人のカードを作れる", errs.length === 0, errs.join(" / "));
  check("指名されていない人は、その依頼を根拠にできない", validateCardInput({ ...nomineeCard, employee_id: "e012" }).some((e) => e.includes("指名していません")));
  check("ない依頼は根拠にできない", validateCardInput({ ...nomineeCard, evidence_request_ids: ["inb-nothing"] }).some((e) => e.includes("存在しません")));

  // ---- 4. 候補の根拠は候補本人の活動だけ
  const base = {
    request_pattern: "theme_specified",
    summary: "テスト",
    nominee_assessment: null,
    learnings_applied: [],
    no_fit: null,
  };
  const cand = (employee_id: string, ids: string[]) => ({ employee_id, card_id: null, theme: "初期表示の改善", reason: "テスト", evidence_activity_ids: ids, cautions: [], is_alternative_to_nominee: false, confidence: "strong", caveat: null });
  const seen = new Set(["act088", "act064"]);
  const other = validateSubmit({ ...base, candidates: [cand("e012", ["act064"])] } as never, seen, null, requests()[1]);
  check("ほかの人の活動を根拠にしたら差し戻す", other.some((e) => e.includes("act064") && e.includes("e012 の活動ではありません")), other.find((e) => e.includes("act064")));
  const own = validateSubmit({ ...base, candidates: [cand("e012", ["act088"])] } as never, seen, null, requests()[1]);
  check("本人の活動なら、書き手の検査では差し戻さない", !own.some((e) => e.includes("の活動ではありません")));

  fs.rmSync(inboxFile, { force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  fs.rmSync(inboxFile, { force: true });
  console.error(e);
  process.exit(1);
});
