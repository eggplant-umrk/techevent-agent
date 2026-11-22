import "./_isolate"; // 元のデータだけで動かす（実行時のデータは一時フォルダ）
// 使ってみて見つかった点の直し（feature/walk-fix）のテスト。API は使わない。
//   npm run test:walkfix   （npm test にも入る）
// 1 保存済みの下書きを返す窓口／2 下書き中と声かけ中／3 「違う」の印と取り消し／4 題名の件数／5 不適切な文の題名を伏せる／6 記録の名前／7 例の依頼の時間
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { OutreachDraft } from "../lib/heavy";
import type { ProposalResult } from "../lib/agent";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "walkfix-test-"));
process.env.INBOX_FILE = path.join(dir, "inbox.json");
process.env.DRAFTS_FILE = path.join(dir, "drafts.json");
process.env.SAMPLE_PROPOSALS_FILE = path.join(dir, "sample_proposals.json");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  const { requestState, STAGE_LABEL } = await import("../lib/requestStage");
  const F = await import("../lib/feedback");
  const { feedbackToCase, employeeNameSet } = await import("../lib/feedbackEval");
  const board = await import("../lib/board");
  const inbox = await import("../lib/inbox");
  const { traceStepLabel } = await import("../lib/traceLabel");
  const N = await import("../lib/readyNotice");
  const draftRoute = await import("../app/api/draft/route");
  const { requests } = await import("../lib/data");

  // ---- 2. 下書き中と声かけ中（lib/requestStage.ts。決めるのはコード）
  const TODAY = "2026-11-22";
  const D = "2027-01-28";
  const p = (id: string) => ({ employee_id: id, name: `人${id}` });
  const rec = (id: string, result: "approved" | "accepted" | "declined" | "published") => ({ ...p(id), result });
  const st = (records: ReturnType<typeof rec>[], drafted: ReturnType<typeof p>[], base: "new" | "processing" | "ready" | "error" = "ready") => requestState(base, records, D, TODAY, drafted);
  check("下書きを作っただけ（打診の記録なし）なら「下書き中」", st([], [p("e1")]).stage === "drafting" && st([], [p("e1")]).drafting_for[0].employee_id === "e1" && STAGE_LABEL.drafting === "下書き中");
  check("声かけ文をコピーして「承認」を記録したら「声かけ中」（下書き中の人からは外れる）", st([rec("e1", "approved")], [p("e1")]).stage === "outreach" && st([rec("e1", "approved")], [p("e1")]).drafting_for.length === 0);
  check("下書きがなければ今までどおり「候補準備済み」", st([], []).stage === "ready" && requestState("ready", [], D, TODAY).stage === "ready");
  check("承諾済みは、ほかの人の下書きがあっても承諾済み", st([rec("e1", "approved"), rec("e1", "accepted")], [p("e1"), p("e2")]).stage === "accepted");
  check("ほかの人に声かけ中なら、別の人の下書きがあっても声かけ中", st([rec("e1", "approved")], [p("e2")]).stage === "outreach");
  check("辞退のあとに別の人の下書きを作ったら「下書き中」", st([rec("e1", "approved"), rec("e1", "declined")], [p("e1"), p("e2")]).stage === "drafting");
  check("辞退した人の下書きが残っているだけなら「辞退」のまま", st([rec("e1", "approved"), rec("e1", "declined")], [p("e1")]).stage === "declined");
  check("準備中・エラー・候補を出す前の依頼は、前の下書きが残っていても下書き中にしない", st([], [p("e1")], "processing").stage === "preparing" && st([], [p("e1")], "error").stage === "error" && st([], [p("e1")], "new").stage === "new");
  check("開催日が過ぎていれば、下書きがあっても開催後", requestState("ready", [], "2026-11-01", TODAY, [p("e1")]).stage === "archived");

  // ---- 1・2・7. 保存した下書き → 状態と、開き直したときの窓口（サンプルの依頼で）
  const sample = requests()[0];
  const result: ProposalResult = {
    run_id: "walkfix",
    request_id: sample.id,
    request_pattern: "open_slot",
    summary: "テスト用",
    nominee_assessment: null,
    learnings_applied: [],
    no_fit: null,
    candidates: [{ employee_id: "e024", name: "織部 隼人", card_id: null, theme: "テーマ", reason: "理由", evidence: [], cautions: [], is_alternative_to_nominee: false, confidence: "strong", caveat: null } as never],
  };
  check("例の依頼：候補を出す前は時間なし", board.boardList().find((x) => x.id === sample.id)?.elapsed_ms === null);
  board.saveSampleProposal(sample.id, result, [], 0.27, 34_000);
  const row = () => board.boardList().find((x) => x.id === sample.id)!;
  check("例の依頼も、候補づくりにかかった時間を出す（34秒）", row().elapsed_ms === 34_000 && row().state.stage === "ready", `${row().elapsed_ms}`);
  const draft: OutreachDraft = { subject: "件名", message: "本文です", lt_outline: [{ minutes: 10, heading: "見出し", points: ["要点"] }], tips_for_pr: ["確認"], organizer_reply: "返事です", organizer_reply_note: null };
  const get = async (q: string) => {
    const res = await draftRoute.GET(new Request(`http://localhost/api/draft?${q}`));
    return { status: res.status, body: (await res.json()) as { draft?: OutreachDraft | null; error?: string } };
  };
  const before = await get(`request_id=${sample.id}&employee_id=e024`);
  check("保存した下書きがなければ draft は null（作り直さない・エラーにしない）", before.status === 200 && before.body.draft === null);
  board.saveDraft(sample.id, "e024", draft);
  const saved = await get(`request_id=${sample.id}&employee_id=e024`);
  check("開き直したとき：保存した下書き（声かけ文・構成案・主催者への返事）をそのまま返す", saved.status === 200 && JSON.stringify(saved.body.draft) === JSON.stringify(draft), JSON.stringify(saved.body).slice(0, 120));
  check("保存の時刻（saved_at）など、下書きにない項目は返さない", !("saved_at" in (saved.body.draft ?? {})));
  check("ほかの人・ほかの依頼の下書きは返さない", (await get(`request_id=${sample.id}&employee_id=e013`)).body.draft === null && (await get(`request_id=req999&employee_id=e024`)).body.draft === null);
  check("request_id・employee_id がなければ 400", (await get("request_id=req001")).status === 400);
  check("下書きを保存しただけで、依頼は「下書き中」になる（打診の記録は付けない）", row().state.stage === "drafting" && row().state.drafting_for.map((x) => x.employee_id).join() === "e024" && row().state.outreach_to.length === 0);
  check("依頼の詳細も同じ状態", board.boardDetail(sample.id)?.state.stage === "drafting");
  const routeSrc = fs.readFileSync(path.join(process.cwd(), "app", "api", "draft", "route.ts"), "utf8");
  check("下書きを返す窓口（GET）は API を使わない（draftOutreach を呼ぶのは POST だけ）", routeSrc.slice(routeSrc.indexOf("export async function GET"), routeSrc.indexOf("// API を使う操作は")).includes("loadDraft") && !routeSrc.slice(routeSrc.indexOf("export async function GET"), routeSrc.indexOf("// API を使う操作は")).includes("draftOutreach"));
  const page = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf8");
  const approve = page.slice(page.indexOf("async function approve("), page.indexOf("async function markOutreach("));
  check("「この人で進める」は、保存した下書きがあればそれを出し、打診の記録（承認）は付けない", approve.includes("api.savedDraft(") && !approve.includes('result: "approved"'));
  const mark = page.slice(page.indexOf("async function markOutreach("), page.indexOf("async function record("));
  check("声かけ文をコピーしたときに「承認」を記録する（声かけ中にする）", mark.includes('result: "approved"') && page.includes("onOutreachCopied={() => void markOutreach()}"));

  // ---- 3. 「この候補は違う」の印と取り消し（記録は消さず、取り消しを足す）
  const parse = (b: Record<string, unknown>) => F.parseFeedback({ request_id: "req001", target: "candidate", target_id: "e013", ...b });
  const w = parse({ verdict: "withdrawn" });
  check("取り消し（withdrawn）を受け付ける（理由は問わない）", w.ok && w.value.verdict === "withdrawn" && w.value.reason_code === F.WITHDRAWN_REASON);
  check("今までの3つ（wrong・edited・good）の受け付けは変わらない", parse({ verdict: "wrong", reason_code: "busy" }).ok && !parse({ verdict: "wrong", reason_code: "x" }).ok && parse({ verdict: "good" }).ok && !parse({ verdict: "maybe" }).ok);
  let n = 0;
  const fb = (target_id: string, verdict: "wrong" | "good" | "withdrawn", reason_code = "theme_mismatch", request_id = "req001") => ({ id: `fb-${n++}`, at: "2026-11-22T12:00:00+09:00", request_id, target: "candidate" as const, target_id, verdict, reason_code });
  const rows = [fb("e013", "wrong"), fb("e024", "wrong", "busy"), fb("e013", "withdrawn", "withdrawn"), fb("e012", "wrong", "other", "req002")];
  const wc = F.wrongCandidates("req001", rows);
  check("違うと付けたままの候補だけを返す（取り消した人は出さない・ほかの依頼は混ぜない）", wc.length === 1 && wc[0].employee_id === "e024" && wc[0].reason === "忙しい", JSON.stringify(wc));
  check("取り消したあとに、もう一度「違う」と付けたら、また印を出す（最後の理由）", F.wrongCandidates("req001", [...rows, fb("e013", "wrong", "not_own_activity")]).find((x) => x.employee_id === "e013")?.reason === "本人の活動ではない");
  check("記録がなければ空", F.wrongCandidates("req001", []).length === 0);
  check("取り消された「違う」は、評価のケースにしない", F.activeFeedback(rows).map((r) => `${r.target_id}:${r.verdict}`).join() === "e024:wrong,e012:wrong");
  const c = feedbackToCase("req001", rows.filter((r) => r.request_id === "req001"), { text: null }, employeeNameSet([]));
  check("評価のケース：取り消した人（e013）は「候補に出さない」に入らない", JSON.stringify(c.case?.params?.unexpected_ids ?? []) === '["e024"]', JSON.stringify(c.case?.params ?? c.skipped));
  F.appendFeedback({ request_id: sample.id, target: "candidate", target_id: "e024", verdict: "wrong", reason_code: "theme_mismatch" });
  check("依頼の詳細に「違うと記録済み」の候補が入る（読み直しても残る）", board.boardDetail(sample.id)?.wrong_candidates?.[0]?.reason === "テーマが合わない");
  F.appendFeedback({ request_id: sample.id, target: "candidate", target_id: "e024", verdict: "withdrawn", reason_code: F.WITHDRAWN_REASON });
  check("取り消すと、詳細の印も消える。記録の行は消さない（2行残る）", (board.boardDetail(sample.id)?.wrong_candidates ?? []).length === 0 && F.readFeedback().filter((r) => r.request_id === sample.id).length === 2);
  const proposal = fs.readFileSync(path.join(process.cwd(), "components", "Proposal.tsx"), "utf8");
  check("候補のカード：「違うと記録済み（理由）」と「取り消す」を出す", proposal.includes("違うと記録済み（{recorded}）") && proposal.includes("取り消す") && proposal.includes('verdict: "withdrawn"'));

  // ---- 4. タブの題名の件数：候補を出す前の例の依頼は数えない
  const items = [
    { id: "a", status: "ready" as const, title: "例1", is_new: true, state: { stage: "new" } },
    { id: "b", status: "ready" as const, title: "例2", is_new: true, state: { stage: "new" } },
    { id: "c", status: "ready" as const, title: "届いた依頼", is_new: true, state: { stage: "ready" } },
  ];
  check("候補を出す前の例の依頼（2件）は数えず、準備済みの1件だけを数える", N.unopenedReadyCount(items, null) === 1 && N.pageTitle(N.unopenedReadyCount(items.slice(0, 2), null)) === "ネタ帳Agent");
  const firstScreen = board.boardList().filter((x) => x.id !== sample.id);
  check("最初の画面（例の依頼だけ・候補を出す前）の題名に件数は付かない", N.unopenedReadyCount(firstScreen, null) === 0, `${N.unopenedReadyCount(firstScreen, null)}`);

  // ---- 5. 雑談・暴言を貼ったとき
  const empty = { value: null, quote: null };
  const rawOf = (kind: "not_request" | "inappropriate", reason: string) => ({ event_name: empty, date: empty, format: empty, theme: empty, organizer: empty, nominee: empty, date_hint: empty, kind: { value: kind, reason } });
  const noRunner = async () => null;
  const abuse = inbox.registerInbox({ text: "お前らの会社のエンジニアは全員無能だな。二度とイベントに出てくるな。", source: "manual" });
  await inbox.prepare(abuse.id, noRunner, async () => rawOf("inappropriate", "社員への暴言のみ"));
  const chat = inbox.registerInbox({ text: "今日のランチ、駅前のカレー屋さんに行ってきました。", source: "manual" });
  await inbox.prepare(chat.id, noRunner, async () => rawOf("not_request", "雑談"));
  const list = board.boardList();
  const abuseRow = list.find((x) => x.id === abuse.id)!;
  check("暴言の原文は、一覧の題名に出さない（「不適切な内容のため表示しません」）", abuseRow.title === inbox.HIDDEN_TITLE && !JSON.stringify(abuseRow).includes("無能"), abuseRow.title);
  check("依頼を開けば、原文は読める（詳細には残す）", board.boardDetail(abuse.id)?.text.includes("無能") === true && board.boardDetail(abuse.id)?.title === inbox.HIDDEN_TITLE);
  check("雑談の題名は今までどおり（本文の先頭）", list.find((x) => x.id === chat.id)?.title.startsWith("今日のランチ") === true);
  check("知らせの文にも、暴言の原文を出さない", N.noticeFor({ id: abuse.id, status: "ready", title: abuseRow.title, kind: "inappropriate" })?.text === "貼った会話は止めました（不適切な内容のため）");
  const inboxSrc = fs.readFileSync(path.join(process.cwd(), "components", "Inbox.tsx"), "utf8");
  const reqSrc = fs.readFileSync(path.join(process.cwd(), "components", "RequestInput.tsx"), "utf8");
  check("依頼ではない・不適切な文には「候補準備済み」の印を出さない（「依頼ではなさそう」「対応しません」）", inboxSrc.includes('return "依頼ではなさそう"') && inboxSrc.includes('return "対応しません"') && inboxSrc.includes("<StageTag stage={it.state.stage} kind={it.kind} />") && reqSrc.includes("<StageTag stage={st.stage} kind={inbox.kind} />"));
  check("依頼ではない・不適切な文には、読み取った項目（未定の12項目）を並べない", reqSrc.includes('inbox.intake && (inbox.kind ?? "request") === "request" && <IntakeRows'));

  // ---- 9・10. 依頼の詳細：未定はたたむ・日程の形
  check("未定の項目は「未定 n件（主催者に聞き返します）」にたたみ、開けば見られる", reqSrc.includes('<details className="intake-undecided">') && reqSrc.includes("未定 {undecided.length}件") && reqSrc.includes("（主催者に聞き返します）") && reqSrc.includes('aria-label="未定の項目"'));
  check("依頼の詳細の日程も、返事・下書きと同じ形にする（displayDate）", reqSrc.includes('i.key === "date" && i.value ? displayDate(i.value) : i.value'));

  // ---- 6. 実行の記録の名前
  const labels: Array<["llm" | "tool" | "code", string, string]> = [
    ["llm", "inbox_extract", "会話を読む"],
    ["llm", "loop", "候補を探す"],
    ["llm", "draft", "下書きを作る"],
    ["llm", "alternative_pitch", "代わりの人を推す文を作る"],
    ["tool", "search_cards", "カードを探す"],
    ["code", "search_cards", "カードを探す"],
    ["tool", "search_activities", "活動を探す"],
    ["tool", "get_card", "カードを読む"],
    ["tool", "get_employee", "人の情報を読む"],
    ["tool", "check_schedule", "予定を確かめる"],
    ["tool", "submit_candidates", "候補を出す"],
  ];
  const wrong = labels.filter(([k, name, want]) => traceStepLabel(k, name) !== want);
  check("記録の名前を、使う人の言葉にする（会話を読む・候補を探す・カードを探す・下書きを作る など）", wrong.length === 0, wrong.map(([, name]) => name).join());
  check("知らない名前：AI の呼び出しは「AI の呼び出し」、日本語の処理の名前はそのまま", traceStepLabel("llm", "claude-opus-5-5") === "AI の呼び出し" && traceStepLabel("code", "日程の候補") === "日程の候補");
  const toolsSrc = fs.readFileSync(path.join(process.cwd(), "lib", "tools.ts"), "utf8");
  const toolNames = [...toolsSrc.matchAll(/name: "([a-z_]+)"/g)].map((m) => m[1]);
  const noLabel = toolNames.filter((name) => traceStepLabel("tool", name) === name);
  check(`ツールの名前（lib/tools.ts の ${toolNames.length} 個）は、すべて言葉に置き換わる`, toolNames.length >= 8 && noLabel.length === 0, noLabel.join());
  check("記録の画面は、置き換えた名前を出す", fs.readFileSync(path.join(process.cwd(), "components", "TraceTimeline.tsx"), "utf8").includes("{traceStepLabel(s.kind, s.name)}"));

  // ---- 7・8. 金額と時間の決まり、ネタ帳の更新の文
  const claude = fs.readFileSync(path.join(process.cwd(), "CLAUDE.md"), "utf8");
  check("CLAUDE.md：依頼ごとの金額と時間は出す。合計と ?debug の表示はそのまま", claude.includes("依頼ごとの金額と時間は出す") && !claude.includes("画面には金額を出さない"));
  check("ネタ帳の更新で新しい活動がないときは「新しい活動はありませんでした」", page.includes('"新しい活動はありませんでした"') && page.includes("e.created + e.updated + e.kept === 0"));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(1);
});
