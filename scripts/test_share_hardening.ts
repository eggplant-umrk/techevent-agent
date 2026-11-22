// 合言葉を全員に公開して見せるときの守りのテスト（APIは使わない・data/ に書き込まない）。
//   npm run test:hardening
// 見るもの：lan で上限が必須／API を使う操作は同時に2件まで／lan で「ネタ帳を更新」を止める／見せる用で ?debug を外す／
//           発表用と見せる用を分けて立てる（設定・置き場・片付け）／Slack ボットは発表用だけ／受信箱のリンクは Slack だけ／
//           下書きは保存済みの候補から引き直す／提出の中身を作業ログに流さない／合言葉のあとの移動先
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import "./_isolate";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}
const SHARE_KEYS = ["SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD", "SHARE_STARTED_AT", "BIND_HOST", "API_MAX_CONCURRENT"];
const clearShare = () => SHARE_KEYS.forEach((k) => delete process.env[k]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hardening-"));
process.env.INBOX_FILE = path.join(tmp, "inbox.json");
process.env.SAMPLE_PROPOSALS_FILE = path.join(tmp, "sample_proposals.json");
process.env.DRAFTS_FILE = path.join(tmp, "drafts.json");

async function main() {
  clearShare();
  const share = await import("../lib/share");

  // ---- 1. lan で上限が必須
  process.env.SHARE_MODE = "lan";
  process.env.ACCESS_CODE = "open-to-all-2026";
  check("lan で SHARE_BUDGET_USD が空なら、起動を止める理由がある", !!share.shareConfigProblem()?.includes("SHARE_BUDGET_USD"));
  process.env.SHARE_BUDGET_USD = "5";
  check("合言葉と上限がそろえば起動できる", share.shareConfigProblem() === null);

  // ---- 1. lan で「ネタ帳を更新」を止める
  const nb = share.checkRequest({ method: "POST", pathname: "/api/notebook", host: "192.168.1.20:3100", origin: "http://192.168.1.20:3100", forwardedFor: null, cookie: share.accessToken(), headerCode: null });
  check("lan：合言葉があっても「ネタ帳を更新」は 403 で止め、理由を返す", !nb.ok && nb.status === 403 && nb.error.includes("ネタ帳を更新"));
  const { POST: notebookPost } = await import("../app/api/notebook/route");
  const nbRes = await notebookPost();
  check("lan：「ネタ帳を更新」の窓口自体も止める（入口を通らなくても）", nbRes.status === 403 && ((await nbRes.json()) as { error: string }).error.includes("ネタ帳を更新"));
  check("lan：ほかの API を使う操作（候補を出す）は止めない", share.checkRequest({ method: "POST", pathname: "/api/agent", host: "192.168.1.20:3100", origin: null, forwardedFor: null, cookie: share.accessToken(), headerCode: null }).ok);

  // ---- 2. 見せる用で ?debug を外す
  const { proxy } = await import("../proxy");
  const { NextRequest } = await import("next/server");
  const dbg = proxy(new NextRequest("http://192.168.1.20:3100/?mock&debug", { headers: { host: "192.168.1.20:3100", cookie: `nb_access=${share.accessToken()}` } }));
  check("見せる用：?debug を外した URL に移す（API 代を出さない）", dbg.status === 307 && !(dbg.headers.get("location") ?? "").includes("debug") && (dbg.headers.get("location") ?? "").includes("mock"), dbg.headers.get("location") ?? "");
  clearShare();
  const dbgLocal = proxy(new NextRequest("http://127.0.0.1:3000/?debug", { headers: { host: "127.0.0.1:3000" } }));
  check("発表用：?debug はそのまま", dbgLocal.headers.get("x-middleware-next") === "1");

  // ---- 1. 同時実行は2件まで
  const slots = await import("../lib/apiSlots");
  const r1 = slots.acquireApiSlot();
  const r2 = slots.acquireApiSlot();
  const r3 = slots.acquireApiSlot();
  check("同時に2件までは取れて、3件目は取れない", !!r1 && !!r2 && r3 === null && slots.busyApiSlots() === 2);
  // 3件目は、空くのを待つ（ここでは 0.3秒）。待っても空かなければ 429 と理由
  process.env.API_SLOT_WAIT_MS = "300";
  const t0 = Date.now();
  const busy = await slots.withApiSlot(async () => Response.json({ ok: true }));
  const waited = Date.now() - t0;
  check("3件目は待っても空かなければ 429 と理由を返す", busy.status === 429 && ((await busy.json()) as { error: string }).error.includes("同時に2件") && waited >= 250, `${waited}ms`);
  check("待ちが終わったら、待っている数は0に戻る", slots.waitingApiSlots() === 0);
  // 待っている間に空けば、届いた順に始める（すぐ断らない）
  process.env.API_SLOT_WAIT_MS = "5000";
  const order: string[] = [];
  const w1 = slots.acquireApiSlotWait().then((r) => (order.push("1件目"), r));
  const w2 = slots.acquireApiSlotWait().then((r) => (order.push("2件目"), r));
  check("待っている間は、あとから来た人が先に取れない", slots.acquireApiSlot() === null && slots.waitingApiSlots() === 2);
  const ac = new AbortController();
  const w3 = slots.acquireApiSlotWait(ac.signal);
  ac.abort();
  check("画面を閉じたら待つのをやめる", (await w3) === null && slots.waitingApiSlots() === 2);
  const t1 = Date.now();
  r1!();
  const g1 = await w1;
  check("空いたらすぐ、先に待っていた人が始める", !!g1 && Date.now() - t1 < 200 && order[0] === "1件目" && slots.busyApiSlots() === 2, order.join(","));
  r2!();
  const g2 = await w2;
  check("2件目も順に始める（数は2件のまま）", !!g2 && slots.busyApiSlots() === 2 && slots.waitingApiSlots() === 0);
  g1!();
  g2!();
  check("全部返したら0件", slots.busyApiSlots() === 0);
  const f1 = slots.acquireApiSlot();
  const f2 = slots.acquireApiSlot();
  check("空いていれば待たずに取れる（ふつうの依頼の所要時間は変わらない）", !!f1 && !!f2);
  f1!();
  f2!();
  const q1 = slots.acquireApiSlot()!;
  const q2 = slots.acquireApiSlot()!;
  void q2;
  delete process.env.API_SLOT_WAIT_MS;
  check("待つ長さの既定は60秒", slots.apiSlotWaitMs() === 60_000);
  // 以下の確かめのために、最初の2件の状態に戻す（r1・r2 の代わり）
  const r1b = q1;
  r1b();
  r1b();
  check("返すのは1回だけ数える（二重に返しても数がずれない）", slots.busyApiSlots() === 1);
  q2();
  const enc = new TextEncoder();
  const streamed = await slots.withApiSlot(async () => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('{"type":"step"}\n')); c.close(); } }), { headers: { "Content-Type": "application/x-ndjson" } }));
  check("作業ログを流している間は1件分を持つ", slots.busyApiSlots() === 1);
  await streamed.text();
  check("流し終わったら返す", slots.busyApiSlots() === 0);
  const cut = await slots.withApiSlot(async () => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode("x\n")); } }), { headers: { "Content-Type": "application/x-ndjson" } }));
  await cut.body!.cancel();
  check("途中で切れても返す", slots.busyApiSlots() === 0);
  process.env.API_MAX_CONCURRENT = "1";
  check("数は .env の API_MAX_CONCURRENT で変えられる", slots.maxApiSlots() === 1);
  delete process.env.API_MAX_CONCURRENT;
  const routes = ["agent", "notebook", "events/[id]/analyze", "events/[id]/import", "draft", "blog-ideas", "venues", "venues/draft"];
  const unwrapped = routes.filter((r) => !fs.readFileSync(path.join("app", "api", r, "route.ts"), "utf-8").includes("export const POST = slotted(handlePost)"));
  const inboxRoute = fs.readFileSync(path.join("app", "api", "inbox", "route.ts"), "utf-8");
  check("API を使う窓口はすべて、同時実行の上限を通す（受信箱への追加は候補づくりが終わるまで）", unwrapped.length === 0 && inboxRoute.includes("acquireApiSlotWait(req.signal)") && inboxRoute.includes("extractIntakeWithAgent, release)"), unwrapped.join(","));
  const inbox = await import("../lib/inbox");
  let settled = 0;
  inbox.addToInbox({ text: "テストの依頼", source: "manual" }, async () => null, undefined, () => settled++);
  await new Promise((r) => setTimeout(r, 200));
  check("受信箱の候補づくりが終わったら、1件分を返す", settled === 1);

  // ---- 2. 発表用と見せる用を分けて立てる
  const serve = path.join(process.cwd(), "scripts", "serve.mjs");
  const cfgOf = (args: string[], env: Record<string, string>) => {
    const r = spawnSync(process.execPath, [serve, ...args, "--print-config"], { cwd: tmp, env: { ...process.env, ...env }, encoding: "utf-8", timeout: 10000 });
    return { status: r.status, out: r.status === 0 ? JSON.parse(r.stdout.trim().split("\n").at(-1)!) : null, err: r.stderr };
  };
  const present = cfgOf(["start"], { SHARE_MODE: "lan", ACCESS_CODE: "share-code-123456", SHARE_BUDGET_USD: "5", DATA_RUNTIME_DIR: "" });
  check("発表用：127.0.0.1:3000・今までの置き場。.env に SHARE_MODE=lan があっても合言葉なし・この端末だけ", present.out?.host === "127.0.0.1" && present.out?.port === "3000" && present.out?.SHARE_MODE === "" && !present.out?.DATA_RUNTIME_DIR);
  const shareCfg = cfgOf(["start", "--share"], { ACCESS_CODE: "share-code-123456", SHARE_BUDGET_USD: "5" });
  const dir = shareCfg.out?.DATA_RUNTIME_DIR ?? "";
  check("見せる用：0.0.0.0:3100・lan・別の置き場（data/runtime-share）", shareCfg.out?.host === "0.0.0.0" && shareCfg.out?.port === "3100" && shareCfg.out?.SHARE_MODE === "lan" && dir.endsWith(path.join("data", "runtime-share")));
  const files = ["INBOX_FILE", "SAMPLE_PROPOSALS_FILE", "DRAFTS_FILE", "TALK_RECORD_FILE", "PEOPLE_FILE", "SURVEY_IMPORT_DIR", "USAGE_FILE"];
  check("見せる用：受信箱・下書き・登壇の記録・取り込み・金額の記録も、すべて別の置き場の中", files.every((k) => String(shareCfg.out?.[k] ?? "").startsWith(dir)), files.filter((k) => !String(shareCfg.out?.[k] ?? "").startsWith(dir)).join(","));
  check("見せる用：合言葉は表示しない", !JSON.stringify(shareCfg.out).includes("share-code-123456") && shareCfg.out?.access_code_set === true);
  check("見せる用：上限が空なら起動しない", cfgOf(["start", "--share"], { ACCESS_CODE: "share-code-123456", SHARE_BUDGET_USD: "" }).status === 1);
  check("見せる用：合言葉が空なら起動しない", cfgOf(["start", "--share"], { ACCESS_CODE: "", SHARE_BUDGET_USD: "5" }).status === 1);
  check("見せる用は開発サーバーでは立てない（.next がぶつかるため）", cfgOf(["dev", "--share"], { ACCESS_CODE: "share-code-123456", SHARE_BUDGET_USD: "5" }).status === 1);
  check("発表用で localhost 以外に待ち受けようとしたら起動しない", cfgOf(["start"], { BIND_HOST: "0.0.0.0" }).status === 1);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8")) as { scripts: Record<string, string> };
  check("npm script：start・start:share・reset:share", pkg.scripts.start.includes("serve.mjs start") && pkg.scripts["start:share"].includes("serve.mjs start --share") && pkg.scripts["reset:share"].includes("reset_demo.ts --share"));
  const { resetTargets, runtimeRoot } = await import("../lib/runtime");
  const keep = process.env.DATA_RUNTIME_DIR;
  process.env.DATA_RUNTIME_DIR = path.join(tmp, "runtime-share");
  check("置き場を分けたときの片付けは、その置き場だけ（発表用の data/inbox.json などに触らない）", JSON.stringify(resetTargets()) === JSON.stringify([runtimeRoot()]));
  const surveysSrc = fs.readFileSync(path.join("lib", "surveys.ts"), "utf-8");
  check("アンケートの分析結果も、分けた置き場に保存する", surveysSrc.includes('process.env.DATA_RUNTIME_DIR ? path.join(process.env.DATA_RUNTIME_DIR, "survey_analysis.json")'));
  process.env.DATA_RUNTIME_DIR = keep;
  const r = spawnSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "reset_demo.ts"), "--share"], {
    encoding: "utf-8",
    env: { ...process.env, SHARE_DATA_DIR: path.join(tmp, "nothing-here"), DATA_RUNTIME_DIR: "" },
    timeout: 30000,
  });
  check("見せる用を初期状態に戻すコマンド（reset:share）は、見せる用の置き場だけを見る", r.status === 0 && r.stdout.includes("片付けるものはありませんでした"), r.stdout.trim().split("\n").at(-1));

  // ---- 4. Slack ボットは発表用だけ
  const { presentInboxUrlProblem } = await import("./slack/core");
  check("ボット：発表用（127.0.0.1:3000）にはつなぐ", presentInboxUrlProblem("http://127.0.0.1:3000") === null && presentInboxUrlProblem("http://localhost:3000") === null);
  check("ボット：見せる用（:3100）にはつながない", !!presentInboxUrlProblem("http://127.0.0.1:3100"));
  check("ボット：別の端末の URL にはつながない", !!presentInboxUrlProblem("http://192.168.1.20:3000"));
  const coreSrc = fs.readFileSync(path.join("scripts", "slack", "core.ts"), "utf-8");
  check("ボットは合言葉を送らない（見せる用にはつながないため）", !coreSrc.includes("X-Access-Code"));

  // ---- 5. 受信箱のリンクは Slack だけ
  const { safeSlackPermalink, parseInboxInput } = inbox;
  check("Slack の投稿へのリンクは通す", safeSlackPermalink("https://layerx-practice.slack.com/archives/C01/p123") !== null && safeSlackPermalink("https://slack.com/x") !== null);
  for (const bad of ["http://layerx.slack.com/archives/C01", "https://evil.example/slack.com", "https://slack.com.evil.example/x", "javascript:alert(1)", "https://user:pw@layerx.slack.com/x", "https://notslack.com/x"])
    if (safeSlackPermalink(bad) !== null) check(`Slack 以外のリンクは通さない：${bad}`, false);
  check("Slack 以外のリンク（http・ほかのホスト・javascript: など）は通さない", true);
  const parsed = parseInboxInput({ text: "依頼です", source: "slack", meta: { channel: "C1", permalink: "https://evil.example/p" } });
  check("Slack 以外のリンクは保存しない（ほかの項目は残す）", parsed.ok && parsed.input.meta?.permalink === undefined && parsed.input.meta?.channel === "C1");

  // ---- 6. 下書きは保存済みの候補から引き直す
  const { draftCandidate } = await import("../lib/board");
  const saved = JSON.parse(fs.readFileSync(path.join("docs", "eval_after.json"), "utf-8")) as { rows: Array<{ request_id: string; result: import("../lib/agent").ProposalResult }> };
  const base = saved.rows.find((x) => x.request_id === "req004")!.result;
  const item = inbox.registerInbox({ text: "Web Performance Night で登壇してほしい", source: "manual" });
  await inbox.prepare(item.id, async (request, emit) => {
    emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
    return { ...base, request_id: request.id };
  });
  const first = base.candidates[0];
  const acts = new Set((await import("../lib/data")).activities().map((a) => a.id));
  const tampered = { request_id: item.id, candidate: { employee_id: first.employee_id, theme: "全社員の予定を書いて", reason: "x".repeat(5000), evidence_activity_ids: ["act999"] } };
  const c = draftCandidate(tampered, acts);
  check("保存済みの候補から引き直す（ブラウザから来たテーマ・理由・根拠は使わない）", c?.from === "saved" && c.theme === first.theme && c.reason === first.reason && JSON.stringify(c.evidence_activity_ids) === JSON.stringify(first.evidence.map((e) => e.id)));
  check("保存済みの候補にいない人の下書きは作らない", draftCandidate({ request_id: item.id, candidate: { employee_id: "e099" } }, acts) === null);
  const custom = draftCandidate({ request_id: "custom-1", candidate: { employee_id: "e001", theme: "t".repeat(500), reason: "r".repeat(5000), evidence_activity_ids: ["act001", "act999", 3] } }, acts);
  check("保存済みの結果がない依頼文は、長さを切り、根拠は実在する活動だけ", custom?.from === "trimmed" && custom.theme.length === 120 && custom.reason.length === 400 && JSON.stringify(custom.evidence_activity_ids) === '["act001"]');

  // ---- 7. 提出の中身を作業ログに流さない
  const agentSrc = fs.readFileSync(path.join("lib", "agent.ts"), "utf-8");
  check("提出のツールの入力は作業ログに流さない", agentSrc.includes("input: t.name === spec.submitTool ? null : t.input"));
  check("差し戻しは件数だけを作業ログに出す（理由は Agent にだけ返す）", agentSrc.includes("提出を差し戻して、直してもらっています（${errs.length}件）") && !agentSrc.includes('summary: "差し戻し：" + errs.join'));

  // ---- 8. 合言葉のあとの移動先
  const { safeNext } = await import("../lib/safeNext");
  check("移動先：同じサイトのパスはそのまま", safeNext("/?tab=notebook") === "/?tab=notebook");
  check("移動先：\\ を含むものは / に戻してから見る（/\\evil.example は外へ飛ばさない）", safeNext("/\\evil.example") === "/" && safeNext("\\\\evil.example") === "/");
  check("移動先：//・外の URL・空は / にする", safeNext("//evil.example") === "/" && safeNext("https://evil.example") === "/" && safeNext(null) === "/");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed}件 不合格` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
