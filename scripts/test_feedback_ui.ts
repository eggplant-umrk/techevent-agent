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
  check("「この候補は違う」の理由は4つ（テーマが合わない・忙しい・本人の活動ではない・その他）", Object.values(fb.WRONG_REASON_LABEL).join("・") === "テーマが合わない・忙しい・本人の活動ではない・その他");
  check("押したあとの一言は「次からの評価に使います」", fb.FEEDBACK_DONE === "次からの評価に使います");
  const { runCostText } = await import("../components/Inbox");
  check("受信箱の1件：$0.81・2分18秒", runCostText({ run_usd: 0.81, elapsed_ms: 138_000 }) === "$0.81・2分18秒", String(runCostText({ run_usd: 0.81, elapsed_ms: 138_000 })));
  check("受信箱の1件：分からなければ出さない", runCostText({ run_usd: 0, elapsed_ms: null }) === null);

  // ---- 実行の記録はこの端末（127.0.0.1）からだけ ----
  const { traceAllowed } = await import("../lib/traceAccess");
  const req = (host: string, xff?: string) => new Request(`http://${host}/api/state`, { headers: { host, ...(xff ? { "x-forwarded-for": xff } : {}) } });
  delete process.env.SHARE_MODE;
  check("発表用（既定）：記録の画面を開ける", traceAllowed(req("127.0.0.1:3000", "127.0.0.1")));
  process.env.SHARE_MODE = "lan";
  check("見せる用：この端末（127.0.0.1）からは開ける", traceAllowed(req("127.0.0.1:3100", "127.0.0.1")) && traceAllowed(req("localhost:3100", "::1")));
  check("見せる用：会場の端末からは開けない", !traceAllowed(req("192.168.1.20:3100", "192.168.1.55")));
  check("見せる用：送り元が分からないときも開けない", !traceAllowed(req("192.168.1.20:3100")));
  check("見せる用：Host だけ localhost にしても、送り元が外なら開けない", !traceAllowed(req("127.0.0.1:3100", "192.168.1.55")));
  process.env.ACCESS_CODE = "test-code-for-feedback";
  process.env.SHARE_BUDGET_USD = "5";
  const { GET: state } = await import("../app/api/state/route");
  const st = (await (await state(req("192.168.1.20:3100", "192.168.1.55"))).json()) as { trace_allowed?: boolean };
  check("/api/state が trace_allowed を返す（会場の端末には false）", st.trace_allowed === false);
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
  check("声かけの下書きをコピーしたら good／edited を送る", approved.includes('useUsedFeedback("draft"') && approved.includes('label="声かけ文をコピー" primary onCopied={used.onUsed}'));
  check("主催者への返事をコピーしたら good／edited を送る", approved.includes('useUsedFeedback("organizer_reply"') && approved.includes('label="返事をコピー" primary onCopied={used.onUsed}'));
  check("送ったあとの一言は、下書きにも返事にも出す", (approved.match(/used\.note && \(/g) ?? []).length === 2);
  const fbSrc = read("app/_client/feedback.tsx");
  check("同じ文を何度コピーしても送るのは1回、直す前と同じなら good・違えば edited", fbSrc.includes("lastSent.current === used") && fbSrc.includes('used === original ? "good" : "edited"'));
  const api = read("app/_client/api.ts");
  check("送り先は POST /api/feedback（記録の側）", api.includes('post("/api/feedback", input)'));
  check("記録がまだない（404）ときは「まだありません」にする", api.includes("if (res.status === 404) return null;"));
  check("記録の側（POST /api/feedback）がまだないうちは、ボタンを出さない（404 なら出さない）", api.includes("return res.status !== 404;") && page.includes("requestId: feedbackReady ? feedbackRequestId : null"));

  // ---- ?mock：手元に残す・見本の記録 ----
  const mock = read("app/_client/mock.ts");
  check("?mock：使われた結果は手元に残すだけ（送らない）", mock.includes("feedbackLog.push(input)") && !/feedback\(input\)[^;]*real\./.test(mock));
  check("?mock：見本の記録には「モックの見本」と出す", read("components/TraceTimeline.tsx").includes("（モックの見本）"));

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
