// 実行の記録・使われた結果の記録・評価のケースへの変換のテスト（本物の API は使わない・data/ に書き込まない）。
//   npm run test:trace
// 見るもの：依頼ごとの記録の形（llm・tool・code、時間・数・金額・成否）／原文・キーを残さない／記録の外では何もしない／
//           同じ依頼は足していく／読む関数（一覧・1件・合計金額）／POST /api/feedback と feedback.jsonl／
//           使われた結果 → 評価のケース（形の検査・個人情報を落とす・リポジトリの外に出す）
import "./_isolate";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trace-"));
process.env.DATA_RUNTIME_DIR = path.join(tmp, "runtime");
process.env.INBOX_FILE = path.join(tmp, "inbox.json");
const SECRET_PROMPT = "ひみつの指示文ABC123";
const FAKE_KEY = "test-fake-key-zzz999";

async function main() {
  // 偽の API：ふつうの返事（使った数つき）。"fail" を含む指示には 400 を返す
  let hits = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits++;
      if (body.includes("fail-please")) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "fake bad request" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [{ type: "text", text: "返事の中身XYZ" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = FAKE_KEY;

  try {
    const { getClient } = await import("../lib/anthropic");
    const { recordUsage } = await import("../lib/usage");
    const trace = await import("../lib/trace");
    const call = async (runId: string, purpose: "inbox_extract" | "loop", text = SECRET_PROMPT) => {
      const res = (await getClient().messages.create({ model: "claude-haiku-5-5", max_tokens: 50, messages: [{ role: "user", content: text }] })) as { model: string; usage: { input_tokens: number; output_tokens: number } };
      recordUsage(runId, purpose, res.model, res.usage as never);
      return res;
    };

    // ---- 1. 実行の記録
    await call("outside", "loop");
    check("記録の外（評価スクリプトなど）では何も残さない", !fs.existsSync(trace.tracesDir()) || fs.readdirSync(trace.tracesDir()).length === 0);

    const RID = "inb-trace-1";
    await trace.withTrace(RID, async () => {
      await call(RID, "inbox_extract");
      const emit = trace.traceEmit(() => {});
      emit({ type: "tool_call", id: "prefetch", name: "search_cards", input: { query: SECRET_PROMPT, by: "code" } });
      emit({ type: "tool_result", id: "prefetch", name: "search_cards", ok: true, summary: SECRET_PROMPT });
      emit({ type: "tool_call", id: "t1", name: "get_employee", input: { employee_id: "e001" } });
      await new Promise((r) => setTimeout(r, 30));
      emit({ type: "tool_result", id: "t1", name: "get_employee", ok: true, summary: "中身" });
      emit({ type: "tool_call", id: "t2", name: "search_cards", input: {} });
      emit({ type: "tool_result", id: "t2", name: "search_cards", ok: false, summary: "失敗の中身" });
      await call(RID, "loop");
      await call(RID, "loop", "fail-please").catch(() => null);
      await trace.traceCode("日程の候補", async () => 1);
    });
    const t = trace.getTrace(RID);
    const raw = fs.readFileSync(trace.traceFile(RID), "utf-8");
    check("依頼ごとに data/runtime/traces/{依頼のid}.json に残る", !!t && fs.existsSync(path.join(process.env.DATA_RUNTIME_DIR!, "traces", `${RID}.json`)));
    const keys = Object.keys(t ?? {}).sort().join(",");
    check("形：request_id・started_at・steps・total_ms・total_cost_usd", keys === "request_id,started_at,steps,total_cost_usd,total_ms" && t!.request_id === RID, keys);
    const kinds = t!.steps.map((s) => `${s.kind}:${s.name}${s.ok ? "" : "×"}`).join(" ");
    check("順に llm・code・tool・llm・llm（失敗）・code が並ぶ", kinds === "llm:inbox_extract code:search_cards tool:get_employee tool:search_cards× llm:loop llm:claude-haiku-5-5× code:日程の候補", kinds);
    const llm = t!.steps[0];
    check("llm の段：使い道の名前・時間・入力と出力の数・金額・成否", llm.name === "inbox_extract" && llm.input_tokens === 1000 && llm.output_tokens === 200 && (llm.cost_usd ?? 0) > 0 && llm.ok && typeof llm.ms === "number" && !!llm.started_at, JSON.stringify(llm));
    const failedLlm = t!.steps.find((s) => s.kind === "llm" && !s.ok);
    check("失敗した呼び出しは ok:false と種類だけ（400）", failedLlm?.error === "400" && failedLlm.cost_usd === undefined, JSON.stringify(failedLlm));
    const tool = t!.steps.find((s) => s.name === "get_employee");
    check("ツールの段は時間を測る（呼び出しから結果まで）", !!tool && tool.ms >= 25, `${tool?.ms}ms`);
    check("合計金額は llm の段の金額の合計", Math.abs(t!.total_cost_usd - t!.steps.reduce((s, x) => s + (x.cost_usd ?? 0), 0)) < 1e-9 && t!.total_cost_usd > 0);
    check("合計時間が入る", t!.total_ms >= 25);
    check("指示文・会話の原文・ツールの入力や結果・返事の中身を残さない", !raw.includes(SECRET_PROMPT) && !raw.includes("返事の中身") && !raw.includes("中身") && !raw.includes("fail-please"));
    check("API キーを残さない", !raw.includes(FAKE_KEY));
    // 同じ依頼は足していく
    const before = t!.steps.length;
    await trace.withTrace(RID, () => call(RID, "loop"));
    const t2 = trace.getTrace(RID)!;
    check("同じ依頼をもう一度動かすと、同じ記録に足す（合計も増える）", t2.steps.length === before + 1 && t2.total_cost_usd > t!.total_cost_usd && t2.started_at === t!.started_at);
    check("依頼1件の合計金額を取れる（requestCostUsd）", trace.requestCostUsd(RID) === t2.total_cost_usd && trace.requestCostUsd("inb-none") === null);
    // 受信箱の1件から（候補づくりの準備 prepare の中が記録される）
    const inbox = await import("../lib/inbox");
    const item = inbox.registerInbox({ text: "12月15日の勉強会でLTをお願いできる方を探しています", source: "manual" });
    await inbox.prepare(item.id, async (_req, emit) => {
      emit({ type: "tool_call", id: "x1", name: "search_cards", input: { query: "q" } });
      emit({ type: "tool_result", id: "x1", name: "search_cards", ok: true, summary: "s" });
      await call(item.id, "loop");
      return null;
    });
    const ti = trace.getTrace(item.id);
    check("受信箱の依頼の候補づくりが、その依頼の id で記録される", !!ti && ti.steps.some((s) => s.kind === "tool") && ti.steps.some((s) => s.kind === "llm" && s.name === "loop"), ti ? ti.steps.map((s) => s.name).join(",") : "なし");
    check("受信箱の1件から合計金額を取れる（requestCostUsd(item.id)）", (trace.requestCostUsd(item.id) ?? 0) > 0);
    // 一覧
    const list = trace.listTraces();
    check("一覧：記録のある依頼が並び、段の数・呼び出しの数・失敗の数が分かる", list.length === 2 && list.some((x) => x.request_id === RID && x.llm_calls === 4 && x.failed_steps === 2), JSON.stringify(list.map((x) => [x.request_id, x.step_count, x.llm_calls, x.failed_steps])));
    fs.writeFileSync(trace.traceFile("inb-broken"), "{壊れ");
    const errLog = console.error;
    console.error = () => {};
    check("壊れた記録は読まずに退ける（一覧・1件とも落ちない）", trace.getTrace("inb-broken") === null && trace.listTraces().length === 2);
    console.error = errLog;
    check("依頼の id はファイル名に使える形にする（フォルダの外に出ない）", path.dirname(trace.traceFile("../../etc/passwd")) === trace.tracesDir());

    // ---- 2. 使われた結果の記録
    const fbm = await import("../lib/feedback");
    const ok = (b: unknown) => fbm.parseFeedback(b).ok;
    const base = { request_id: "req001", target: "candidate", target_id: "e001", verdict: "wrong", reason_code: "busy" };
    check("候補の理由：テーマが合わない・忙しい・本人の活動ではない・その他", ["theme_mismatch", "busy", "not_own_activity", "other"].every((r) => ok({ ...base, reason_code: r })) && !ok({ ...base, reason_code: "wording" }));
    check("下書きの理由：言い回し・事実の誤り・長さ・その他", ["wording", "factual_error", "length", "other"].every((r) => ok({ ...base, target: "draft", reason_code: r })) && !ok({ ...base, target: "draft", reason_code: "busy" }));
    check("「よい」は理由なしでも付けられる", ok({ ...base, verdict: "good", reason_code: undefined }));
    check("形の違う入力は断る（target・verdict・id の形・文字列でない note）", !ok({ ...base, target: "x" }) && !ok({ ...base, verdict: "maybe" }) && !ok({ ...base, request_id: "../x" }) && !ok({ ...base, note: 3 }) && !ok(null) && !ok([1]));
    const route = await import("../app/api/feedback/route");
    const post = (b: unknown) => route.POST(new Request("http://127.0.0.1/api/feedback", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b), headers: { "content-type": "application/json" } }));
    const r1 = await post({ ...base, note: "連絡先は taro@example.com", before: "前", after: "後" });
    const r1b = (await r1.json()) as { id?: string };
    check("POST /api/feedback：足して id を返す", r1.status === 200 && /^fb-/.test(r1b.id ?? ""));
    const r2 = await post({ ...base, request_id: item.id, target: "draft", target_id: "e002", verdict: "edited", reason_code: "length" });
    check("受信箱の依頼にも付けられる", r2.status === 200);
    check("ない依頼には付けない（404）", (await post({ ...base, request_id: "req999" })).status === 404);
    check("JSON でない本文は 400", (await post("{oops")).status === 400);
    const lines = fs.readFileSync(fbm.feedbackFile(), "utf-8").trim().split("\n");
    const first = JSON.parse(lines[0]);
    check("data/runtime/feedback.jsonl に1行ずつ足す", fbm.feedbackFile() === path.join(process.env.DATA_RUNTIME_DIR!, "feedback.jsonl") && lines.length === 2);
    check("1行の形：id・at・request_id・target・target_id・verdict・reason_code・note・before・after", ["id", "at", "request_id", "target", "target_id", "verdict", "reason_code", "note", "before", "after"].every((k) => k in first), Object.keys(first).join(","));
    fs.appendFileSync(fbm.feedbackFile(), '{"書きかけ');
    console.error = () => {};
    check("書きかけの行は飛ばして読む", fbm.readFeedback().length === 2);
    console.error = errLog;

    // ---- 3. 使われた結果 → 評価のケース
    const fe = await import("../lib/feedbackEval");
    const { evalCaseProblems } = await import("../lib/evalTypes");
    const { employees } = await import("../lib/data");
    const emp = employees()[0];
    const keep = fe.employeeNameSet(employees().map((e) => e.name));
    const dirty = `主催の山田花子さんです。${emp.name}さんにお願いしたいです。連絡は hanako@example.co.jp か 090-1234-5678、03-1234-5678 まで。〒150-0002 東京都渋谷区渋谷2-24-12 です。X は @hanako_dev。佐藤と申します。開催は 2026-12-15、19:00〜。`;
    const clean = fe.scrubText(dirty, keep);
    check("メール・電話・郵便番号・住所・アカウント名を落とす", !/example|090-1234|03-1234|150-0002|渋谷区|@hanako/.test(clean), clean);
    check("社員の実名以外の人名らしきもの（◯◯さん・◯◯と申します）を落とす", !clean.includes("山田花子") && !clean.includes("佐藤と申します") && clean.includes("（名前）さん"), clean);
    check("社員の実名と、日付・時刻は残す", clean.includes(`${emp.name}さん`) && clean.includes("2026-12-15") && clean.includes("19:00"), clean);
    const fb = (o: Partial<import("../lib/feedback").Feedback>) => ({ id: "fb-1", at: "2026-11-22T10:00:00+09:00", request_id: "inb-x", target: "candidate", target_id: "e001", verdict: "good", reason_code: "good", ...o }) as import("../lib/feedback").Feedback;
    const src = { text: dirty, channel: "manual" as const, received_at: "2026-11-22T09:00:00+09:00", recorded: { status: "ready", intake: { organizer: "山田花子", event_name: "勉強会" } as never, result: null } };
    const keepCase = fe.feedbackToCase("inb-x", [fb({})], src, keep).case!;
    check("「よい」だけ → 保つ評価（keep）・その人が候補に入る", keepCase.suite === "keep" && keepCase.checks.includes("expected_in_candidates") && JSON.stringify(keepCase.params?.expected_ids) === '["e001"]');
    check("ケースの形の検査（evalCaseProblems）に通る", evalCaseProblems(keepCase).length === 0, evalCaseProblems(keepCase).join("／"));
    check("出どころは usage・origin.ref はもとの依頼の id・入力は貼られた文", keepCase.source === "usage" && keepCase.origin?.ref === "inb-x" && keepCase.input.kind === "inbox");
    const caseText = JSON.stringify(keepCase);
    check("ケースの中に個人情報が残らない（主催者の名前も落とす）", !/example|090-1234|山田花子|渋谷区|@hanako/.test(caseText), caseText.slice(0, 200));
    const raiseCase = fe.feedbackToCase("req001", [fb({ verdict: "wrong", reason_code: "not_own_activity", request_id: "req001" }), fb({ target: "draft", target_id: "e002", verdict: "edited", reason_code: "factual_error", before: "前の文", after: "後の文" })], { text: null }, keep).case!;
    check("「違う・直した」→ 上げる評価（raise）・候補に出さない・下書きは AI の判定の観点", raiseCase.suite === "raise" && raiseCase.checks.includes("not_in_candidates") && !!raiseCase.judge?.some((j) => j.target === "outreach") && raiseCase.input.kind === "request");
    check("本人の活動ではない・事実の誤りは、不満 3（信頼をなくす）", raiseCase.priority.pain === 3 && evalCaseProblems(raiseCase).length === 0, JSON.stringify(raiseCase.priority));
    check("直す前・直したあとの文はケースに入れない", !JSON.stringify(raiseCase).includes("前の文") && !JSON.stringify(raiseCase).includes("後の文"));
    check("判定にできない使われた結果は出さない（理由つき）", fe.feedbackToCase("req001", [fb({ target: "intake_field", target_id: "theme", verdict: "wrong", reason_code: "misread" })], { text: null }, keep).case === null);
    // スクリプト（npm run eval:from-feedback）：一時フォルダの中で流す
    const r = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "eval_from_feedback.ts")], { env: { ...process.env }, encoding: "utf-8" });
    const outDir = path.join(process.env.DATA_RUNTIME_DIR!, "eval_candidates");
    const files = fs.existsSync(outDir) ? fs.readdirSync(outDir) : [];
    check("npm run eval:from-feedback：data/runtime/eval_candidates/ にケースの候補を出す", r.status === 0 && files.length === 2, `${r.status} ${files.join(",")} ${r.stdout.trim().split("\n")[0] ?? ""}${r.stderr.slice(0, 200)}`);
    const outText = files.map((f) => fs.readFileSync(path.join(outDir, f), "utf-8")).join("\n");
    check("出したケースに、メールなどの個人情報が残らない", !outText.includes("taro@example.com"));
    const tracked = spawnSync("git", ["status", "--porcelain", "--", "data"], { encoding: "utf-8" }).stdout.trim();
    check("リポジトリには何も足さない（自動でコミットしない・data/ は変わらない）", tracked === "", tracked);
    check("偽の API にだけ届いた（本物の API は使っていない）", hits > 0 && process.env.ANTHROPIC_BASE_URL!.startsWith("http://127.0.0.1"));
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
