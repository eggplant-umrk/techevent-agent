// 依頼の状態と、受信箱への一本化のテスト（API を使わない）。
//   npm run test:stage
// 状態：準備中 → 候補準備済み → 声かけ中 → 承諾済み／辞退 → 開催後。判定はコード（lib/requestStage.ts）。
// data/inbox.json・サンプルの候補・下書きは一時ファイルに書く。カード（data/cards.json）は最後に元に戻す。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = (name: string) => path.join(os.tmpdir(), `stage-test-${Date.now()}-${name}.json`);
process.env.INBOX_FILE = tmp("inbox");
process.env.SAMPLE_PROPOSALS_FILE = tmp("samples");
process.env.DRAFTS_FILE = tmp("drafts");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

async function main() {
  const { requestState, recordsFor, acceptedRequestIds, STAGE_LABEL } = await import("../lib/requestStage");
  const TODAY = "2026-11-21";
  const r = (employee_id: string, result: "approved" | "accepted" | "declined" | "published") => ({ employee_id, name: employee_id, result });

  // ---- 状態の決め方（コード）
  check("記録がなければ受信箱の状態（準備中）", requestState("processing", [], "2027-01-28", TODAY).stage === "preparing");
  check("記録がなければ受信箱の状態（候補準備済み）", requestState("ready", [], "2027-01-28", TODAY).stage === "ready");
  check("サンプルの依頼で候補をまだ出していなければ「候補を出す前」", requestState("new", [], "2027-01-28", TODAY).stage === "new");
  check("承認したら声かけ中", requestState("ready", [r("e013", "approved")], "2027-01-28", TODAY).stage === "outreach");
  const acc = requestState("ready", [r("e013", "approved"), r("e013", "accepted")], "2027-01-28", TODAY);
  check("承諾を記録したら承諾済み（誰が受けたかも）", acc.stage === "accepted" && acc.accepted_by[0]?.employee_id === "e013");
  check("辞退を記録したら辞退", requestState("ready", [r("e013", "approved"), r("e013", "declined")], "2027-01-28", TODAY).stage === "declined");
  const again = requestState("ready", [r("e013", "approved"), r("e013", "declined"), r("e014", "approved")], "2027-01-28", TODAY);
  check("辞退のあとに別の候補へ声をかけたら、また声かけ中", again.stage === "outreach" && again.outreach_to[0]?.employee_id === "e014" && again.declined_by[0]?.employee_id === "e013");
  check("公開も承諾として扱う", requestState("ready", [r("e013", "approved"), r("e013", "accepted"), r("e013", "published")], null, TODAY).stage === "accepted");
  check("開催日が過ぎたら開催後（アーカイブ）", requestState("ready", [r("e013", "accepted")], "2026-11-10", TODAY).stage === "archived");
  check("開催日が今日ならまだ開催後ではない", requestState("ready", [], TODAY, TODAY).stage === "ready");
  check("状態の名前", STAGE_LABEL.outreach === "声かけ中" && STAGE_LABEL.accepted === "承諾済み");

  const cards = [
    { employee_id: "e013", outreach_history: [{ request_id: "req004", result: "approved" as const, date: "2026-11-20" }, { request_id: "req004", result: "declined" as const, date: "2026-11-21" }] },
    { employee_id: "e014", outreach_history: [{ request_id: "req004", result: "approved" as const, date: "2026-11-21" }, { request_id: "req001", result: "accepted" as const, date: "2026-11-21" }] },
  ];
  const recs = recordsFor("req004", cards, (id) => id);
  check("打診記録はその依頼の分だけ、日付の順", recs.map((x) => `${x.employee_id}:${x.result}`).join(",") === "e013:approved,e013:declined,e014:approved");
  check("カード側：承諾した依頼（依頼ごとの最後の記録で決める）", acceptedRequestIds(cards[1]).join(",") === "req001" && acceptedRequestIds(cards[0]).length === 0);

  // ---- 受信箱への一本化（サンプルの依頼も届いた依頼として並ぶ）
  const cardsFile = path.join(process.cwd(), "data", "cards.json");
  const backup = fs.readFileSync(cardsFile);
  try {
    const board = await import("../lib/board");
    const { requests } = await import("../lib/data");
    const { appendOutreach, loadCards } = await import("../lib/cards");
    const list = board.boardList();
    const samples = list.filter((x) => x.source === "sample");
    check("サンプルの依頼が受信箱に並ぶ（開催日が先のものすべて）", samples.length === requests().filter((x) => !(x.event?.date && x.event.date < TODAY)).length && samples.length > 0, `${samples.length}件`);
    check("候補をまだ出していないサンプルは「候補を出す前」", samples.every((x) => x.state.stage === "new"));
    const saved = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_after.json"), "utf-8")) as { rows: Array<{ request_id: string; result: import("../lib/agent").ProposalResult }> };
    const res = saved.rows.find((x) => x.request_id === "req004")!.result;
    board.saveSampleProposal("req004", res, [], 0.1);
    const d0 = board.boardDetail("req004")!;
    check("候補を出したら保存され「候補準備済み」になる", d0.state.stage === "ready" && d0.result?.candidates.length === res.candidates.length);
    check("サンプルでないもの（手で貼った文など）は保存しない", (board.saveSampleProposal("custom-x", res, [], 0), !board.boardDetail("custom-x")));

    const c1 = res.candidates[0];
    const card1 = loadCards().find((c) => c.employee_id === c1.employee_id)!;
    appendOutreach(card1.card_id, { request_id: "req004", result: "approved", reason: null, event_date: null });
    check("承認を記録したら一覧でも声かけ中", board.boardList().find((x) => x.id === "req004")?.state.stage === "outreach");
    appendOutreach(card1.card_id, { request_id: "req004", result: "declined", reason: "busy", event_date: null });
    check("辞退を記録したら辞退（次の人を選べる）", board.boardDetail("req004")!.state.stage === "declined");
    const c2 = res.candidates.find((c) => c.employee_id !== c1.employee_id)!;
    const card2 = loadCards().find((c) => c.employee_id === c2.employee_id)!;
    appendOutreach(card2.card_id, { request_id: "req004", result: "approved", reason: null, event_date: null });
    check("別の候補に声をかけたら、また声かけ中", board.boardDetail("req004")!.state.stage === "outreach");
    board.saveDraft("req004", c2.employee_id, { subject: "s", message: "m", lt_outline: [], tips_for_pr: [], organizer_reply: "ご連絡ありがとうございます！弊社の担当がお力になれそうです。" });
    appendOutreach(card2.card_id, { request_id: "req004", result: "accepted", reason: null, event_date: null });
    const d1 = board.boardDetail("req004")!;
    check("承諾を記録したら承諾済み。誰が受けたかも出す", d1.state.stage === "accepted" && d1.state.accepted_by[0]?.employee_id === c2.employee_id, d1.state.accepted_by.map((p) => p.name).join("・"));
    check("承諾済みの依頼を開くと、主催者への返事の下書きが出る", d1.accepted_reply?.text.startsWith("ご連絡ありがとうございます") === true);
    check("一覧にも承諾済み", board.boardList().find((x) => x.id === "req004")?.state.stage === "accepted");
    check("カード側：承諾した人のカードに承諾済みの依頼", acceptedRequestIds(loadCards().find((c) => c.card_id === card2.card_id)!).includes("req004"));
    // 承諾の取り消し（記録を1つ戻す）：画面の「承諾を取り消す」と同じ窓口
    const { POST: undo } = await import("../app/api/outcome/undo/route");
    const call = (body: object) => undo(new Request("http://localhost:3000/api/outcome/undo", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) }));
    const u1 = await call({ request_id: "req004", card_id: card2.card_id });
    check("承諾を取り消すと、声かけ中に戻る", u1.status === 200 && board.boardDetail("req004")!.state.stage === "outreach");
    const u2 = await call({ request_id: "req004", card_id: card2.card_id });
    check("最後の記録が承諾でなければ取り消せない（声かけは戻さない）", u2.status === 400 && board.boardDetail("req004")!.state.stage === "outreach");
  } finally {
    fs.writeFileSync(cardsFile, backup);
    for (const f of [process.env.INBOX_FILE!, process.env.SAMPLE_PROPOSALS_FILE!, process.env.DRAFTS_FILE!]) fs.rmSync(f, { force: true });
  }

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
