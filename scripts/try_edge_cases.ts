// 受信箱に貼られる入力の試験（scripts/fixtures/edge_cases.ts）のうち、代表の10件を本物の API で流す（API代がかかる。上限 $1.5）。
//   TRY_ENV_FILE=<.env の場所> npx tsx scripts/try_edge_cases.ts          … 10件を流して docs/edge_cases_result.json に保存
//   npx tsx scripts/try_edge_cases.ts --list                               … 30件の一覧を表にして出すだけ（API は使わない）
// 受信箱に貼ったときと同じ流れ：読み取り（intake）→ 候補づくり（runAgent）→ 声かけ文と主催者への返事（draftOutreach）
// - .env はこのプロセスにだけ読む。キーの値は表示しない
// - 受信箱は一時ファイル、実行時のデータも一時フォルダ（data/inbox.json・data/runtime/・カードには書かない）。打診の結果は書き戻さない
// - 上限（TRY_LIMIT_USD、既定 1.5）を超えないように、1件ごと・下書きの前に残りを見る。10件すべての読み取りと候補づくりを優先し、
//   下書き（重いモデル）は、残りの件数の分を取り置いたうえで余裕があるときだけ作る
// - 「出てはいけない言葉」（一覧の mustNotAppear）が各段階の文に出たかは、コードで見る
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { API_CASES, EDGE_CASES, type EdgeCase } from "./fixtures/edge_cases";

const LIMIT = Number(process.env.TRY_LIMIT_USD || "1.5");
/** 1件の読み取り＋候補づくりの見込み（今までの記録の上のほう）と、下書き1回の見込み（今までの最大） */
const CASE_MAX_USD = 0.2;
const CASE_RESERVE_USD = 0.12;
const DRAFT_MAX_USD = 0.21;
const OUT = path.join(process.cwd(), "docs", "edge_cases_result.json");

if (process.argv.includes("--list")) {
  console.log("| id | 種類 | 入力 | 期待する動き | 本番 |\n| --- | --- | --- | --- | --- |");
  for (const c of EDGE_CASES) {
    const t = c.text.replace(/\s+/g, " ");
    console.log(`| ${c.id} | ${c.group} | ${c.title}：「${t.length > 70 ? `${t.slice(0, 70)}…」（${c.text.length}字）` : `${t}」`} | ${c.expect} | ${c.api ? "流す" : ""} |`);
  }
  process.exit(0);
}

const hits = (c: EdgeCase, text: string | null | undefined) => (text ? (c.mustNotAppear ?? []).filter(([, re]) => re.test(text)).map(([what, re]) => `${what}（「${text.match(re)?.[0]}」）`) : []);

async function main() {
  const envFile = process.env.TRY_ENV_FILE || ".env";
  if (!fs.existsSync(envFile)) {
    console.error(`${envFile} がありません（TRY_ENV_FILE で場所を指定）`);
    process.exit(1);
  }
  process.loadEnvFile(envFile);
  for (const k of ["DATA_SOURCE", "DEMO_PERSON", "SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD"]) delete process.env[k]; // 架空データ・この端末だけで確かめる
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "try-edge-"));
  process.env.INBOX_FILE = path.join(tmpDir, "inbox.json");
  process.env.DATA_RUNTIME_DIR = path.join(tmpDir, "runtime");
  process.env.DRAFTS_FILE = path.join(tmpDir, "drafts.json");

  const { registerInbox, prepare, getInboxItem } = await import("../lib/inbox");
  const { extractIntakeWithAgent } = await import("../lib/intake");
  const { runAgent } = await import("../lib/agent");
  const { draftOutreach } = await import("../lib/heavy");
  const { resolveRequest } = await import("../lib/requests");
  const { organizerReplyProblems } = await import("../lib/organizerReply");
  const { employees, usage } = await import("../lib/data");
  const { totalUsd } = await import("../lib/usage");

  // 判断が要るもの・不適切なものを先に（下書きまで見たい順）
  const order = ["J1", "J2", "B4", "B3", "B1", "F4", "F3", "R2", "R7", "R1"];
  const cases = order.map((id) => API_CASES.find((c) => c.id === id)!).filter(Boolean);
  const t0 = totalUsd();
  const spent = () => totalUsd() - t0;
  const results: unknown[] = [];
  try {
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const left = cases.length - i - 1;
      if (spent() + CASE_MAX_USD > LIMIT) {
        results.push({ id: c.id, group: c.group, title: c.title, skipped: `上限 $${LIMIT} を超えそうなので流していない（ここまで $${spent().toFixed(3)}）` });
        console.log(`# ${c.id} ${c.title}：上限のため流していない`);
        continue;
      }
      const before = spent();
      const started = Date.now();
      const reg = registerInbox({ text: c.text, source: "manual" });
      await prepare(reg.id, (request, emit) => runAgent(request, emit), extractIntakeWithAgent);
      const it = getInboxItem(reg.id)!;
      const afterPrepare = spent();
      const r = it.result;
      const intake = it.intake;

      // ---- 1. 読み取り
      const fields = intake ? { event_name: intake.event_name, date: intake.date, format: intake.format, theme: intake.theme, organizer: intake.organizer, date_hint: intake.date_hint ?? null } : null;
      const decided = Object.entries(fields ?? {}).filter(([k, v]) => v && k !== "date_hint").map(([k]) => k);

      // ---- 2. 候補（技術広報が読む画面）
      const candTexts = [
        { where: "要約", text: r?.summary },
        { where: "指名の確認", text: r?.nominee_assessment },
        ...(r?.no_fit?.reasons ?? []).map((t) => ({ where: "見つからない理由", text: t })),
        ...(r?.no_fit?.next_checks ?? []).map((t) => ({ where: "次に確認すること", text: t })),
        ...(r?.candidates ?? []).flatMap((x) => [
          { where: `${x.name}のテーマ案`, text: x.theme },
          { where: `${x.name}の理由`, text: x.reason },
          { where: `${x.name}の引っかかる点`, text: x.caveat },
          { where: `${x.name}の注意点`, text: x.cautions.join("／") },
        ]),
      ];
      const candHits = candTexts.flatMap((t) => hits(c, t.text).map((h) => `${t.where}：${h}`));
      const toolCalls = it.events.filter((e) => e.type === "tool_call").map((e) => (e as { name?: string }).name ?? "?");
      const n = r?.candidates.length ?? 0;
      const countOk = c.expectCandidates === "zero" ? n === 0 : c.expectCandidates === "some" ? n > 0 : true;

      // ---- 3. 声かけ文と主催者への返事（候補がいて、上限に余裕があるときだけ）
      const first = r?.candidates[0];
      let draft: Record<string, unknown>;
      if (!first) draft = { skipped: "候補がいないので、声かけ文も主催者への返事も作っていない" };
      else if (spent() + DRAFT_MAX_USD + left * CASE_RESERVE_USD > LIMIT) draft = { skipped: `残り ${left} 件の分を取り置くと上限 $${LIMIT} を超えそうなので、下書きは作っていない（ここまで $${spent().toFixed(3)}）` };
      else {
        try {
          const request = resolveRequest({ request_id: reg.id })!;
          const d = await draftOutreach(reg.id, request, { employee_id: first.employee_id, theme: first.theme, reason: first.reason, evidence_activity_ids: first.evidence.map((e) => e.id) });
          const v = d.value;
          const others = employees().filter((e) => e.id !== first.employee_id).map((e) => e.name);
          const outline = v.lt_outline.flatMap((s) => [s.heading, ...s.points]).join("／");
          draft = {
            for: first.name,
            model: `${d.model}${d.fellBack ? "（作り直し）" : ""}`,
            subject: v.subject,
            message: v.message,
            tips_for_pr: v.tips_for_pr,
            outline_headings: v.lt_outline.map((s) => s.heading),
            organizer_reply: v.organizer_reply ?? null,
            organizer_reply_note: v.organizer_reply_note ?? null,
            calls: usage().filter((u) => u.run_id === reg.id && u.purpose === "draft").length,
            hits_in_message: hits(c, `${v.subject}\n${v.message}`),
            hits_in_outline: hits(c, outline),
            hits_in_tips: hits(c, v.tips_for_pr.join("／")),
            hits_in_reply: hits(c, v.organizer_reply),
            reply_check: organizerReplyProblems(v.organizer_reply ?? "", first.name, others),
          };
        } catch (e) {
          draft = { error: e instanceof Error ? e.message : String(e) };
        }
      }

      const row = {
        id: c.id,
        group: c.group,
        title: c.title,
        input: c.text,
        expect: c.expect,
        /** 評価（docs/evals.md）が読む形（EvalOutput）。カードの写しは大きいので外す */
        output: {
          status: it.status,
          intake: it.intake ?? null,
          result: r ? { ...r, candidates: r.candidates.map((x) => ({ ...x, card: null })) } : null,
          draft: typeof draft.message === "string" ? { subject: String(draft.subject ?? ""), message: draft.message, organizer_reply: (draft.organizer_reply as string | null) ?? null, organizer_reply_note: (draft.organizer_reply_note as string | null) ?? null } : null,
          recorded_at: new Date().toISOString(),
          usd: Number((spent() - before).toFixed(4)),
        },
        seconds: Math.round((Date.now() - started) / 1000),
        usd: { read_and_candidates: Number((afterPrepare - before).toFixed(4)), draft: Number((spent() - afterPrepare).toFixed(4)) },
        intake: { fields, decided, undecided: intake?.undecided ?? [], reasons: intake?.reasons ?? {}, nominee: it.nominee },
        candidates: {
          status: it.status,
          error: it.error,
          pattern: r?.request_pattern ?? null,
          summary: r?.summary ?? null,
          nominee_assessment: r?.nominee_assessment ?? null,
          count: n,
          count_as_expected: countOk,
          list: (r?.candidates ?? []).map((x) => ({ name: x.name, confidence: x.confidence, is_nominee: x.is_nominee, theme: x.theme, reason: x.reason, caveat: x.caveat, cautions: x.cautions })),
          no_fit: r?.no_fit ?? null,
          tool_calls: toolCalls,
          steps: it.events.filter((e) => e.type === "step").length,
          retries: it.events.filter((e) => e.type === "retry").length,
          errors: it.events.filter((e) => e.type === "error").map((e) => (e as { message: string }).message),
          date_hint_used: it.date_suggestions?.hint ?? null,
          hits: candHits,
        },
        draft,
      };
      results.push(row);
      console.log(
        `# ${c.id} ${c.title}：読み取れた項目 ${decided.length}／候補 ${n}人（期待 ${c.expectCandidates}：${countOk ? "合う" : "違う"}）／ツール ${toolCalls.length}回／出てはいけない言葉 ${candHits.length + ((draft.hits_in_reply as string[] | undefined)?.length ?? 0) + ((draft.hits_in_message as string[] | undefined)?.length ?? 0)}件／$${(spent() - before).toFixed(3)}（累計 $${spent().toFixed(3)}）`,
      );
      // 1件ごとに保存（途中で止まっても、そこまでの結果が残る）
      fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), limit_usd: LIMIT, spent_usd: Number(spent().toFixed(4)), results }, null, 2) + "\n");
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log(`\n今回 $${spent().toFixed(3)}（上限 $${LIMIT}）／保存：docs/edge_cases_result.json`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
