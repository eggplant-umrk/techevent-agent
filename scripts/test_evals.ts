import "./_isolate"; // 元のデータだけで動かす（実行時のデータ・金額の記録は一時ファイル）
// 評価（docs/evals.md）のテスト（API は使わない）。npm test と CI に入る。
//   npm run test:evals
// 見るもの：
//   1. ケースの形（lib/evalTypes.ts）：点数・優先度・許せる失敗率の計算、形の検査
//   2. 保つ評価：結合テスト69件が10件のケースに全部入っている／入力の試験30件に優先度と判定がある／点数が 90% 以上
//   3. 上げる評価：流せる／形が正しい。main の点数（docs/evals_baseline.json）より 5% 以上下がっていない
//   4. AI の判定：観点ごとに1回・根拠の引用が見せた文になければ「分からない」（偽の呼び出しで流す）
//   5. コードの判定：通るべき結果に通り、落ちるべき結果に落ちる
import fs from "node:fs";
import path from "node:path";
import type { ProposalResult } from "../lib/agent";
import type { EvalCase, EvalOutput } from "../lib/evalTypes";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  const T = await import("../lib/evalTypes");
  const { CHECK_NAMES, runChecks } = await import("./evals/checks");
  const { edgeCases, legacyChecks, legacyCases, raiseCases, judgeOffline } = await import("./evals/cases");
  const { runKeep, runRaise } = await import("./evals/run");
  const J = await import("./evals/judge");
  const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

  // ---- 1. 形と点数
  check("重み＝頻度 × 不満", T.priorityWeight({ frequency: 3, pain: 3 }) === 9 && T.priorityWeight({ frequency: 1, pain: 2 }) === 2);
  check("優先度が高い＝重み 6 以上", T.isHighPriority({ frequency: 2, pain: 3 }) && T.isHighPriority({ frequency: 3, pain: 2 }) && !T.isHighPriority({ frequency: 2, pain: 2 }));
  const cv = (v: Array<"pass" | "fail" | "unknown">) => T.caseVerdict(v.map((verdict, i) => ({ name: String(i), verdict })));
  check("1件の結果：fail が1つでもあれば不合格、unknown だけなら数えない", cv(["pass", "fail"]) === false && cv(["pass", "unknown"]) === true && cv(["unknown"]) === null && cv(["unknown", "fail"]) === false);
  const sc = T.weightedScore([{ weight: 9, passed: true }, { weight: 1, passed: false }, { weight: 6, passed: null }]);
  check("点数：重みつきの通った割合（分からないは入れない）", sc !== null && Math.abs(sc - 0.9) < 1e-9 && T.weightedScore([{ weight: 3, passed: null }]) === null, String(sc));
  check("許せる失敗率：3回中1回の失敗は 0.34 なら通る、0 なら通らない", T.withinAllowedFailures(2, 3, 0.34) && !T.withinAllowedFailures(2, 3, 0) && T.withinAllowedFailures(3, 3, 0) && !T.withinAllowedFailures(0, 0, 0.5));
  const base: EvalCase = { id: "t-1", source: "handmade", title: "t", input: { kind: "inbox", text: "依頼です" }, expect: "候補を出す", checks: ["candidates_some"], priority: { frequency: 2, pain: 2 }, allowed_failure_rate: 0.34, suite: "keep" };
  check("形の検査：正しいケースは問題なし", T.evalCaseProblems(base, CHECK_NAMES).length === 0, T.evalCaseProblems(base, CHECK_NAMES).join("／"));
  const bad: Array<[string, Partial<EvalCase>]> = [
    ["id に空白", { id: "t 1" }],
    ["登録されていない判定", { checks: ["nai_hantei"] }],
    ["判定が1つもない", { checks: [] }],
    ["優先度が範囲の外", { priority: { frequency: 4 as 3, pain: 1 } }],
    ["許せる失敗率が 1 以上", { allowed_failure_rate: 1 }],
    ["期待する動きが空", { expect: " " }],
    ["使われた結果なのに、もとの id がない", { source: "usage" }],
    ["入力の文がない", { input: { kind: "inbox" } as never }],
    ["suite が違う", { suite: "other" as never }],
  ];
  for (const [what, patch] of bad) check(`形の検査：${what} を見つける`, T.evalCaseProblems({ ...base, ...patch }, CHECK_NAMES).length > 0);
  check("形の検査：AI の判定だけのケース（checks が空・judge あり）は通る", T.evalCaseProblems({ ...base, checks: [], judge: [{ aspect: "自然さ", question: "自然な文か", target: "outreach" }] }, CHECK_NAMES).length === 0);

  // ---- 2. 保つ評価
  const legacy = legacyChecks();
  const lc = legacyCases(legacy);
  check("結合テストの判定は69件以上で、すべて10件のケースのどれかに入っている", legacy.length >= 69 && lc.unmatched.length === 0 && lc.cases.length === 10, `${legacy.length}件・入らなかった ${lc.unmatched.length}件`);
  check("読み替えたケースの判定の数の合計＝結合テストの判定の数", lc.results.reduce((n, r) => n + r.checks.length, 0) === legacy.length);
  const edges = edgeCases();
  check("入力の試験は33件で、すべてに優先度と判定がある", edges.length === 33 && edges.every((c) => c.checks.length > 0 && c.priority.frequency >= 1 && c.priority.pain >= 1));
  const edgeProblems = edges.flatMap((c) => T.evalCaseProblems(c, CHECK_NAMES));
  check("入力の試験のケースは、形の検査に通る", edgeProblems.length === 0, edgeProblems.slice(0, 2).join("／"));
  check("信頼をなくす失敗（不満 3）のケースは、1回の失敗も許さない", edges.filter((c) => c.priority.pain === 3).every((c) => c.allowed_failure_rate === 0) && edges.some((c) => c.priority.pain === 3));
  check("入力の試験は、どれもオフラインで1つは判定できる（全部「分からない」のケースがない）", edges.map(judgeOffline).every((r) => r.passed !== null), edges.map(judgeOffline).filter((r) => r.passed === null).map((r) => r.id).join(","));
  const keep = runKeep();
  check(`保つ評価：点数 ${pct(keep.score)} は 90% 以上（${keep.cases}件。不合格 ${keep.failed}件）`, keep.score !== null && keep.score >= T.KEEP_PASS_RATE && keep.problems.length === 0, [...keep.problems, ...keep.results.filter((r) => r.passed === false).map((r) => `${r.id}：${r.checks.find((c) => c.verdict === "fail")?.name}`)].slice(0, 4).join("／"));
  check("保つ評価は40件以上（結合テスト10件＋入力の試験30件＋使われた結果）", keep.cases >= 40);
  // 上げる評価から保つ評価に移したケース（docs/evals.md の10）
  const { promotedCases } = await import("./evals/cases");
  const promoted = promotedCases();
  check("移したケース（N2・F3・req004）は保つ評価に入っていて、直したあとの本番の結果で通る", promoted.length >= 3 && promoted.every((c) => c.suite === "keep" && !!c.recorded && !!c.origin?.note && T.evalCaseProblems(c, CHECK_NAMES).length === 0) && promoted.every((c) => keep.results.find((r) => r.id === c.id)?.passed === true), promoted.map((c) => `${c.id}:${keep.results.find((r) => r.id === c.id)?.passed}`).join(" "));
  check("移したケースは、上げる評価には残っていない（id が重ならない）", !raiseCases().some((c) => /F3-first-request-date|N2-date-decided-later|req004-theme/.test(c.id)) && new Set(keep.results.map((r) => r.id)).size === keep.results.length);

  // ---- 3. 上げる評価
  const raise = runRaise();
  check(`上げる評価：流せて、形が正しい（${raise.cases}件。点数 ${pct(raise.score)}）`, raise.cases >= 3 && raise.problems.length === 0, raise.problems.slice(0, 2).join("／"));
  check("上げる評価には、AI に判定させる観点を持つケースがあり、オフラインでは「分からない」になる", raiseCases().some((c) => c.judge?.length) && raise.results.some((r) => r.checks.some((c) => c.name.startsWith("AI：") && c.verdict === "unknown")));
  const baselineFile = path.join(process.cwd(), "docs", "evals_baseline.json");
  if (fs.existsSync(baselineFile)) {
    const b = JSON.parse(fs.readFileSync(baselineFile, "utf-8")) as { raise: number | null };
    const drop = b.raise !== null && raise.score !== null ? b.raise - raise.score : 0;
    check(`上げる評価：保存してある点数（${pct(b.raise)}）より 5% 以上下がっていない（いま ${pct(raise.score)}）`, drop < T.RAISE_MAX_DROP);
  } else check("（docs/evals_baseline.json がないので、点数の比べは省略）", true);

  // ---- 4. AI の判定（偽の呼び出し）
  const shown = "百瀬さん、こんにちは。10月のバンドル改善で初期表示を1.8秒縮めた件、とても良い取り組みだと思いました。もしお忙しければ、遠慮なく断ってください。";
  const out: EvalOutput = { draft: { message: shown } };
  const jc: EvalCase = { ...base, checks: [], judge: [{ aspect: "具体性", question: "数字を挙げているか", target: "outreach" }, { aspect: "断りやすさ", question: "断りやすさを残しているか", target: "outreach" }, { aspect: "主催者への返事", question: "丁寧か", target: "organizer_reply" }] };
  const asked: string[] = [];
  const answers = [
    { verdict: "yes", quote: "初期表示を1.8秒縮めた", reason: "数字がある" },
    { verdict: "no", quote: "この一節は見せた文にない", reason: "断りにくい" },
  ];
  const res = await J.judgeCase(jc, out, async (_s, user) => {
    asked.push(user);
    return JSON.stringify(answers[asked.length - 1]);
  });
  check("AI の判定：観点ごとに1回ずつ聞く（見せる文がない観点は聞かない）", asked.length === 2 && asked[0].includes("数字を挙げているか") && !asked[0].includes("断りやすさ"));
  check("AI の判定：根拠の引用が見せた文にあれば、はい → 合格", res[0].verdict === "pass", res[0].detail);
  check("AI の判定：根拠の引用が見せた文になければ「分からない」（不合格にしない）", res[1].verdict === "unknown" && !!res[1].detail?.includes("引用"), res[1].detail);
  check("AI の判定：見せる文がない観点は「分からない」", res[2].verdict === "unknown");
  check("AI の判定：AI が「分からない」と答えたら「分からない」", J.toVerdict({ verdict: "unknown", quote: null, reason: "根拠が足りない" }, shown).verdict === "unknown");
  check("AI の判定：いいえ＋正しい引用 → 不合格", J.toVerdict({ verdict: "no", quote: "遠慮なく断ってください", reason: "x" }, shown).verdict === "fail");
  check("AI の判定：答えの形が読めなければ「分からない」", J.toVerdict({ verdict: "maybe" as never, quote: "x", reason: "" }, shown).verdict === "unknown" && J.toVerdict(null, shown).verdict === "unknown");
  const broken = await J.judgeCase({ ...jc, judge: [jc.judge![0]] }, out, async () => "JSON ではない");
  check("AI の判定：呼び出しが壊れた答えを返しても「分からない」で続く", broken[0].verdict === "unknown");
  check("AI の判定：指示文に「分からない」と根拠の引用の決まりがある", J.JUDGE_SYSTEM.includes("unknown") && J.JUDGE_SYSTEM.includes("そのまま抜き出す") && JSON.stringify(J.JUDGE_SCHEMA).includes("unknown"));

  // ---- 5. コードの判定（保存済みの結果で）
  const latest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_latest.json"), "utf-8")) as { rows: Array<{ request_id: string; result: ProposalResult }> };
  const good = latest.rows.find((r) => r.request_id === "req001")!.result;
  const run = (checks: string[], o: EvalOutput, params: Record<string, unknown> = {}) => runChecks({ ...base, checks, params }, o).map((r) => r.verdict);
  const allChecks = ["candidates_some", "candidates_max", "strong_first_and_caveat", "evidence_valid", "no_internal_terms", "no_fit_has_reason"];
  check("コードの判定：保存済みの候補（req001）は、候補の判定にすべて通る", run(allChecks, { result: good }).every((v) => v === "pass"), run(allChecks, { result: good }).join(","));
  check("コードの判定：想定候補がいる・いない", run(["expected_in_candidates"], { result: good }, { expected_ids: [good.candidates[0].employee_id] })[0] === "pass" && run(["expected_in_candidates"], { result: good }, { expected_ids: ["e999"] })[0] === "fail");
  const six = { ...good, candidates: [...good.candidates, ...good.candidates].slice(0, 6) };
  check("コードの判定：候補が6人なら落ちる", run(["candidates_max"], { result: six })[0] === "fail");
  const leaked = { ...good, candidates: good.candidates.map((c, i) => (i === 0 ? { ...c, reason: "card_id が act088 のカードです" } : c)) };
  check("コードの判定：理由に内部の言葉があれば落ちる", run(["no_internal_terms"], { result: leaked })[0] === "fail");
  const stolen = { ...good, candidates: good.candidates.map((c, i) => (i === 0 ? { ...c, evidence: [{ ...c.evidence[0], id: "act999" }] } : c)) };
  check("コードの判定：実在しない根拠があれば落ちる", run(["evidence_valid"], { result: stolen })[0] === "fail");
  check("コードの判定：出てはいけない言葉", run(["no_forbidden_words"], { result: good }, { must_not_appear: [["ない言葉", "ぜったいに出ない言葉"]] })[0] === "pass" && run(["no_forbidden_words"], { result: good }, { must_not_appear: [["候補の名前", good.candidates[0].theme.slice(0, 6).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")]] })[0] === "fail");
  check("コードの判定：材料がなければ「分からない」（落とさない）", run(["candidates_some", "no_internal_terms", "organizer_reply_clean", "intake_matches"], {}).every((v) => v === "unknown"));
  check("コードの判定：候補0人と下書きなし", run(["candidates_zero", "no_draft"], { result: { ...good, candidates: [], no_fit: { reasons: ["依頼ではない"], next_checks: [] } } }).every((v) => v === "pass") && run(["candidates_zero"], { result: good })[0] === "fail");
  check("コードの判定：入口で断る・受け付ける", run(["entry_rejected"], {})[0] === "fail" && runChecks({ ...base, input: { kind: "inbox", text: "   " }, checks: ["entry_rejected"] }, {})[0].verdict === "pass");
  check("コードの判定：登録されていない名前は落ちる", run(["nai_hantei"], {})[0] === "fail");
  // 使われた結果 → ケース（lib/feedbackEval.ts）が使う判定
  const ids = good.candidates.map((c) => c.employee_id);
  check("コードの判定：候補に出してはいけない人（not_in_candidates）", run(["not_in_candidates"], { result: good }, { unexpected_ids: ["e999"] })[0] === "pass" && run(["not_in_candidates"], { result: good }, { unexpected_ids: [ids[0]] })[0] === "fail" && run(["not_in_candidates"], {}, { unexpected_ids: ["e999"] })[0] === "unknown");
  const usage = (expected: string[]) => runChecks({ ...base, source: "usage", origin: { ref: "inb-x" }, checks: ["expected_in_candidates"], params: { expected_ids: expected } }, { result: good })[0].verdict;
  check("コードの判定：使われた結果のケースでは、よいと付けた人が全員いること（手で作ったケースは、いずれか）", usage([ids[0], ids[1]]) === "pass" && usage([ids[0], "e999"]) === "fail" && run(["expected_in_candidates"], { result: good }, { expected_ids: [ids[0], "e999"] })[0] === "pass");
  const intake = { event_name: "Backend Craft Night #12", date: "2026-12-10", format: "LT（10分）", theme: null, organizer: "高田", undecided: ["theme"], reasons: {} } as never;
  const fm = (expected: Record<string, string>, o: EvalOutput = { intake }) => run(["intake_fields_match"], o, { intake_expected: expected })[0];
  check("コードの判定：人が直した読み取りと合う（intake_fields_match）", fm({ date: "2026-12-10", event_name: "Backend Craft Night ＃12" }) === "pass" && fm({ format: "LT(10分)" }) === "pass" && fm({ organizer: "高田さん" }) === "pass");
  check("コードの判定：人が直した値と違えば落ちる・読み取りがなければ「分からない」", fm({ date: "2026-12-11" }) === "fail" && fm({ theme: "障害対応" }) === "fail" && fm({ organizer: "田中" }) === "fail" && fm({ date: "2026-12-10" }, {}) === "unknown");
  const { feedbackToCase } = await import("../lib/feedbackEval");
  const fb = (patch: Record<string, unknown>) => ({ request_id: "inb-test", target: "candidate", target_id: "e012", verdict: "good", reason_code: "other", note: null, after: null, ...patch }) as never;
  const converted = feedbackToCase("inb-test", [fb({}), fb({ target_id: "e002", verdict: "bad" }), fb({ target: "intake_field", target_id: "date", verdict: "bad", after: "2026-12-10" })], { text: "依頼です。12月10日にお願いします", channel: "manual", received_at: "2026-11-21T10:00:00+09:00", recorded: { result: good } } as never, new Set<string>());
  const convProblems = converted.case ? T.evalCaseProblems(converted.case, CHECK_NAMES) : ["ケースにならなかった"];
  check("使われた結果から変換したケースの判定の名前は、すべて登録されている（形の検査に通る）", convProblems.length === 0 && ["expected_in_candidates", "not_in_candidates", "intake_fields_match"].every((n) => converted.case!.checks.includes(n)), convProblems.join("／") || converted.case?.checks.join(","));
  const reply = "ご連絡ありがとうございます！弊社の" + good.candidates[0].name.split(" ")[0] + "がお力になれそうです。本人に確認して、あらためてご連絡します。";
  check("コードの判定：主催者への返事", run(["organizer_reply_clean"], { result: good, draft: { organizer_reply: reply } })[0] === "pass" && run(["organizer_reply_clean"], { result: good, draft: { organizer_reply: `${reply}年収は900万円です。` } })[0] === "fail");

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
