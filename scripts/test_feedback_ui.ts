// 使われた結果のボタンと、実行の記録の画面のテスト（API は使わない）。npm run test:feedback-ui
//   記録の側（POST /api/feedback・traces を読む関数）は③。ここは画面側の決まりだけを確かめる
import "./_isolate";
import fs from "node:fs";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf-8");

async function main() {
  // ---- 表示の言い方 ----
  const fb = await import("../app/_client/feedback");
  check("時間の言い方：2分18秒・41秒・850ミリ秒", fb.durationText(138_000) === "2分18秒" && fb.durationText(41_200) === "41秒" && fb.durationText(850) === "850ミリ秒", `${fb.durationText(138_000)} ${fb.durationText(41_200)} ${fb.durationText(850)}`);
  check("金額の言い方：$0.81・$0.004", fb.usdText(0.81) === "$0.81" && fb.usdText(0.004) === "$0.004");
  check("押したあとの一言は「次からの評価に使います」", fb.FEEDBACK_DONE === "次からの評価に使います");
  const { runCostText } = await import("../components/Inbox");
  check("受信箱の1件：$0.81・2分18秒", runCostText({ run_usd: 0.81, elapsed_ms: 138_000 }) === "$0.81・2分18秒", String(runCostText({ run_usd: 0.81, elapsed_ms: 138_000 })));
  check("受信箱の1件：分からなければ出さない", runCostText({ run_usd: 0, elapsed_ms: null }) === null);

  // ---- 実行の記録は、発表用でも見せる用でも開ける（中身は名前・時間・金額・成否だけ。11/22 から） ----
  const { traceAllowed } = await import("../lib/traceAccess");
  const req = (host: string, xff?: string) => new Request(`http://${host}/api/state`, { headers: { host, ...(xff ? { "x-forwarded-for": xff } : {}) } });
  delete process.env.SHARE_MODE;
  check("発表用（既定）：記録の画面を開ける", traceAllowed(req("127.0.0.1:3000", "127.0.0.1")));
  process.env.SHARE_MODE = "lan";
  check("見せる用：会場の端末からも開ける", traceAllowed(req("192.168.1.20:3100", "192.168.1.55")) && traceAllowed(req("127.0.0.1:3100", "127.0.0.1")));
  process.env.ACCESS_CODE = "test-code-for-feedback";
  process.env.SHARE_BUDGET_USD = "5";
  const { GET: state } = await import("../app/api/state/route");
  const st = (await (await state(req("192.168.1.20:3100", "192.168.1.55"))).json()) as { trace_allowed?: boolean; feedback_reasons?: unknown };
  check("/api/state が trace_allowed を返す（見せる用の会場の端末でも true）", st.trace_allowed === true);
  const { REASON_CODES } = await import("../lib/feedback");
  check("/api/state の理由の選択肢は、記録の側の REASON_CODES そのもの", JSON.stringify(st.feedback_reasons) === JSON.stringify(REASON_CODES));
  check("「この候補は違う」の理由は テーマが合わない・忙しい・本人の活動ではない・その他", Object.values(REASON_CODES.candidate).join("・") === "テーマが合わない・忙しい・本人の活動ではない・その他");
  check("返事（reply）の理由は下書きと同じ、intake_field は 読み違い・読み落とし・その他", JSON.stringify(REASON_CODES.reply) === JSON.stringify(REASON_CODES.draft) && Object.values(REASON_CODES.intake_field).join("・") === "読み違い・読み落とし・その他");
  const prop = read("components/Proposal.tsx");
  check("画面は理由を自分で持たず、受け取った選択肢（reasons.candidate）を出す", prop.includes("Object.entries(reasons.candidate)") && !/WRONG_REASON_LABEL|not_their_work/.test(prop + read("app/_client/feedback.tsx")));
  delete process.env.SHARE_MODE;
  delete process.env.ACCESS_CODE;
  delete process.env.SHARE_BUDGET_USD;

  // ---- 画面のつなぎ ----
  const page = read("app/page.tsx");
  check("記録の画面は trace_allowed のときだけ出す", /traceAllowed && feedbackRequestId && !running && \(\s*<TraceTimeline/.test(page) && page.includes("setTraceAllowed(s.trace_allowed !== false)"));
  check("記録の画面は、開いたときだけ読み込む（設定・新しいタブは作らない）", read("components/TraceTimeline.tsx").includes("if (next && trace === undefined)") && !/tab === "trace"|"trace" as Tab/.test(page));
  const proposal = read("components/Proposal.tsx");
  check("候補のカードに「この候補は違う」（確認の窓は出さない）", proposal.includes("<WrongCandidate employeeId={c.employee_id} />") && !/confirm\(|window\.confirm|<dialog/.test(proposal));
  const approved = read("components/Approved.tsx");
  check("声かけの下書きをコピーしたら good／edited を送る", approved.includes('useUsedFeedback("draft"') && approved.includes('label="声かけ文をコピー"') && approved.includes("used.onUsed(t);")); // コピーのときに「声かけ中」の記録もする（onCopied）ので、形が変わった
  check("主催者への返事をコピーしたら good／edited を送る", approved.includes('useUsedFeedback("reply"') && approved.includes('label="返事をコピー" primary onCopied={used.onUsed}'));
  check("送ったあとの一言は、下書きにも返事にも出す", (approved.match(/used\.note && \(/g) ?? []).length === 2);
  const fbSrc = read("app/_client/feedback.tsx");
  check("同じ文を何度コピーしても送るのは1回、直す前と同じなら good・違えば edited", fbSrc.includes("lastSent.current === used") && fbSrc.includes("const good = used === original;") && fbSrc.includes("verdict: good ? \"good\" : \"edited\""));
  const api = read("app/_client/api.ts");
  check("送り先は POST /api/feedback（記録の側）", api.includes('post("/api/feedback", input)'));
  check("記録がまだない（404）ときは「まだありません」にする", api.includes("if (res.status === 404) return null;"));
  check("窓口があるかを GET /api/feedback で確かめない（ブラウザのコンソールに 405 を出さない）", !/safeFetch\("\/api\/feedback", \{ method: "GET" \}\)/.test(api) && api.includes("feedbackReady: async () => true") && page.includes("requestId: feedbackReady ? feedbackRequestId : null") && page.includes("reasons: feedbackReasons"));

  // ---- ?mock：手元に残す・見本の記録 ----
  const mock = read("app/_client/mock.ts");
  check("?mock：使われた結果は手元に残すだけ（送らない）", mock.includes("feedbackLog.push(input)") && !/feedback\(input\)[^;]*real\./.test(mock));
  check("?mock：見本の記録には「モックの見本」と出す", read("components/TraceTimeline.tsx").includes("（モックの見本）"));

  // ---- 記録の側（③）の窓口が、画面の送る形を受け付けるか ----
  {
    const { POST: feedbackPost } = await import("../app/api/feedback/route");
    const H = { host: "localhost:3000", "content-type": "application/json" };
    const send = async (input: import("../app/_client/feedback").FeedbackInput) =>
      feedbackPost(new Request("http://localhost:3000/api/feedback", { method: "POST", headers: H, body: JSON.stringify(input) }));
    const cases: Array<[string, import("../app/_client/feedback").FeedbackInput]> = [
      ["この候補は違う（忙しい）", { request_id: "req005", target: "candidate", target_id: "e024", verdict: "wrong", reason_code: "busy" }],
      ["この候補は違う（本人の活動ではない）", { request_id: "req005", target: "candidate", target_id: "e024", verdict: "wrong", reason_code: "not_own_activity" }],
      ["この候補は違う（その他＋ひとこと）", { request_id: "req005", target: "candidate", target_id: "e024", verdict: "wrong", reason_code: "other", note: "部署が違う" }],
      ["下書きを直して使った（edited・直す前と後）", { request_id: "req005", target: "draft", target_id: "e007", verdict: "edited", reason_code: "other", before: "件名\n\n本文", after: "件名（直した）\n\n本文" }],
      ["返事を直さずに使った（good）", { request_id: "req005", target: "reply", target_id: "e007", verdict: "good", reason_code: "good" }],
    ];
    for (const [name, input] of cases) {
      const r = await send(input);
      check(`記録の側が受け付ける：${name}`, r.status === 200, `${r.status} ${r.status === 200 ? "" : JSON.stringify(await r.json())}`);
    }
    const { REASON_CODES: RC } = await import("../lib/feedback");
    for (const code of Object.keys(RC.candidate)) {
      const r = await send({ request_id: "req005", target: "candidate", target_id: "e024", verdict: "wrong", reason_code: code });
      if (r.status !== 200) check(`記録の側が受け付ける：理由 ${code}`, false, `${r.status}`);
    }
    check("「この候補は違う」の理由はどれを選んでも記録の側が受け付ける", true);
  }

  // ---- この依頼の記録の窓口（GET /api/traces/{id}） ----
  {
    const { traceFile } = await import("../lib/trace");
    const id = "req005";
    fs.mkdirSync(path.dirname(traceFile(id)), { recursive: true });
    fs.writeFileSync(
      traceFile(id),
      JSON.stringify({
        request_id: id,
        started_at: "2026-11-21T10:00:00+09:00",
        total_ms: 12_000,
        total_cost_usd: 0.12,
        steps: [
          { kind: "llm", name: "loop", model: "claude-opus-5-5", started_at: "2026-11-21T10:00:00+09:00", ms: 9000, cost_usd: 0.12, ok: true },
          { kind: "tool", name: "search_cards", started_at: "2026-11-21T10:00:09+09:00", ms: 300, ok: false, error: "timeout" },
        ],
      }),
    );
    const { GET: traceGet } = await import("../app/api/traces/[id]/route");
    const get = (rid: string, host = "127.0.0.1:3000", xff = "127.0.0.1") =>
      traceGet(new Request(`http://${host}/api/traces/${rid}`, { headers: { host, "x-forwarded-for": xff } }), { params: Promise.resolve({ id: rid }) });
    const ok = await get(id);
    const j = (await ok.json()) as { trace?: { steps: unknown[]; total_cost_usd: number } };
    check("記録の窓口：記録があれば返す（名前・時間・金額・成否）", ok.status === 200 && j.trace?.steps.length === 2 && j.trace.total_cost_usd === 0.12);
    check("記録の窓口：なければ 404（画面は「まだありません」）", (await get("req001")).status === 404);
    check("記録の窓口：形の違う id は 400", (await get("../etc")).status === 400);
    const presenterTrace = traceFile(id);
    process.env.SHARE_MODE = "lan";
    process.env.ACCESS_CODE = "test-code-for-feedback";
    process.env.SHARE_BUDGET_USD = "5";
    // 見せる用では、実行の記録はその人の場所（visitors/{人}/traces/。lib/visitorScope.ts）にある。人の印のない要求は no-person の場所
    fs.mkdirSync(path.dirname(traceFile(id)), { recursive: true });
    fs.copyFileSync(presenterTrace, traceFile(id));
    check("記録の窓口：見せる用で会場の端末からも開ける", (await get(id, "192.168.1.20:3100", "192.168.1.55")).status === 200);
    check("記録の窓口：見せる用でもこの端末からは開ける", (await get(id, "127.0.0.1:3100", "127.0.0.1")).status === 200);
    delete process.env.SHARE_MODE;
    delete process.env.ACCESS_CODE;
    delete process.env.SHARE_BUDGET_USD;
  }

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
