// API 層の試験（npm run test:api）：本物のサーバーを立てて、窓口に本当に要求を投げる。返り値と、置き場（一時フォルダ）の変化を確かめる。
// - API は偽の Anthropic（scripts/testing/fake_anthropic.mjs）。本物の API は使わない。Slack には投稿しない
// - サーバーは本番用のビルドで、3201番（発表用）と3202番（見せる用）。3000番・3100番は使わない（TEST_API_PORT で始まりを変えられる）
// - 置き場は一時フォルダ。終わったら消す。リポジトリの data/ が変わっていないことも確かめる
// - SKIP_BUILD=1 なら、すでにある .next を使う（続けて流すとき）
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildApp, FAKE_KEY, startApp, tempDir } from "../../scripts/testing/app_server.mjs";
import { startFakeAnthropic } from "../../scripts/testing/fake_anthropic.mjs";

const PORT = Number(process.env.TEST_API_PORT || 3201);
const ACCESS_CODE = "test-layers-access-code";
const BUDGET = "0.03";

let failed = 0;
let passed = 0;
function check(name, ok, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (f, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf-8"));
  } catch {
    return fallback;
  }
};
const gitData = () => spawnSync("git", ["status", "--porcelain", "--", "data"], { encoding: "utf-8" }).stdout.trim();

function client(base, headers = {}) {
  const call = async (method, p, body, extra = {}) => {
    const res = await fetch(base + p, {
      method,
      redirect: "manual",
      headers: { ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* HTML や NDJSON */
    }
    return { status: res.status, data, text, headers: res.headers };
  };
  return {
    get: (p, extra) => call("GET", p, undefined, extra),
    post: (p, body, extra) => call("POST", p, body ?? {}, extra),
    /** 受信箱に入れて、準備が終わるまで待つ */
    async addAndWait(text, maxMs = 60_000) {
      const r = await call("POST", "/api/inbox", { text, source: "manual" });
      if (!r.data?.id) return { add: r, detail: null };
      const until = Date.now() + maxMs;
      let d = null;
      while (Date.now() < until) {
        await sleep(500);
        d = (await call("GET", `/api/inbox/${r.data.id}/detail`)).data;
        if (d && d.status !== "processing") break;
      }
      return { add: r, detail: d };
    },
  };
}

const REQUEST_TEXT = "「Test Layers Night」運営の者です。2026年12月18日（金）19時〜、LT10分で登壇をお願いできる方を探しています。テーマは LLM の評価やテストです。";

async function main() {
  const dataBefore = gitData();
  const fake = await startFakeAnthropic();
  buildApp(fake.url);
  const presentDir = tempDir("api-present");
  const shareDir = tempDir("api-share");
  const logDir = tempDir("api-logs");
  let present;
  let share;
  try {
    [present, share] = await Promise.all([
      startApp({ profile: "present", port: PORT, fakeUrl: fake.url, dir: presentDir, logFile: path.join(logDir, "present.log") }),
      startApp({ profile: "share", port: PORT + 1, fakeUrl: fake.url, dir: shareDir, logFile: path.join(logDir, "share.log"), extraEnv: { ACCESS_CODE, SHARE_BUDGET_USD: BUDGET } }),
    ]);
    const api = client(present.base);

    // ---- 1. 依頼を貼る → 候補が出る
    console.log("\n━ 依頼を貼る → 候補が出る");
    const callsBefore = fake.calls.length;
    const t0 = Date.now();
    const { add, detail } = await api.addAndWait(REQUEST_TEXT);
    const id = add.data?.id;
    check("POST /api/inbox が id を返す", add.status === 200 && /^inb-/.test(id ?? ""), `${add.status} ${add.text.slice(0, 80)}`);
    check("準備が終わって ready になる", detail?.status === "ready", `${detail?.status} ${detail?.error ?? ""}（${Math.round((Date.now() - t0) / 1000)}秒）`);
    const cands = detail?.result?.candidates ?? [];
    check("候補が1人以上出る", cands.length >= 1, `${cands.length}人${fake.notes.length ? `／偽の API のメモ：${fake.notes.at(-1)}` : ""}`);
    check("候補に名前・テーマ・根拠がある", cands.length > 0 && cands.every((c) => c.name && c.theme && (c.evidence?.length ?? 0) >= 1));
    const mine = fake.calls.slice(callsBefore);
    check("偽の API に、読み取りと候補を探すループが届いた（にせのキー）", mine.some((c) => c.kind === "intake") && mine.some((c) => c.kind === "loop") && mine.every((c) => FAKE_KEY.startsWith(c.key)));
    const inbox = readJson(path.join(presentDir, "inbox.json"), []);
    const items = Array.isArray(inbox) ? inbox : inbox.items ?? [];
    check("置き場の inbox.json に依頼が入った", items.some((x) => x.id === id && x.status === "ready"));
    const usage = readJson(path.join(presentDir, "usage.json"), []);
    const records = Array.isArray(usage) ? usage : usage.records ?? [];
    check("置き場の usage.json に、使った分が記録された", records.length >= 2, `${records.length}件`);
    const dup = await api.post("/api/inbox", { text: REQUEST_TEXT, source: "manual" });
    check("同じ文をもう一度貼ると、新しく足さずに同じ依頼を返す", dup.data?.id === id && dup.data?.duplicate === true);

    // ---- 2. 依頼ではない文で止まる
    console.log("\n━ 依頼ではない文で止まる");
    const c2 = fake.calls.length;
    const urlOnly = await api.post("/api/inbox", { text: "https://example.com/events/123", source: "manual" });
    check("URL だけ：400 で止まり、API を呼ばない", urlOnly.status === 400 && /依頼の文が見つかりません/.test(urlOnly.data?.error ?? "") && fake.calls.length === c2, urlOnly.text.slice(0, 80));
    const chat = await api.addAndWait("先日の勉強会、ありがとうございました！資料もとても分かりやすかったです。またご飯でも行きましょう。");
    check("雑談：受け付けるが、種類は「依頼ではない」", chat.detail?.kind === "not_request", `${chat.detail?.kind} ${chat.detail?.status}`);
    check("雑談：候補を作らない（候補を探すループを呼ばない）", (chat.detail?.result?.candidates ?? []).length === 0 && !fake.calls.slice(c2).some((c) => c.kind === "loop"));
    // 貼った文を /api/agent・/api/draft に直接送る道は閉じた（受信箱の関所を通らないため）
    const c2b = fake.calls.length;
    const directAgent = await api.post("/api/agent", { request_id: "custom-x", custom_text: REQUEST_TEXT });
    const directDraft = await api.post("/api/draft", { run_id: "x", request_id: "custom-x", custom_text: REQUEST_TEXT, candidate: { employee_id: "e001", theme: "t", reason: "r", evidence_activity_ids: [] } });
    check("貼った文を直接送る：/api/agent も /api/draft も 400 で断り、API を呼ばない", directAgent.status === 400 && directDraft.status === 400 && /受信箱/.test(directAgent.data?.error ?? "") && fake.calls.length === c2b, `${directAgent.status} ${directDraft.status}`);

    // ---- 3. 承諾と取り消し
    console.log("\n━ 承諾と取り消し");
    const c = cands[0];
    if (!c) check("（承諾の試験には候補が要る）", false);
    else {
      const appr = await api.post("/api/outcome", { request_id: id, card_id: c.card_id, result: "approved" });
      check("この人で進める（approved）が通る", appr.status === 200, appr.text.slice(0, 80));
      const acc = await api.post("/api/outcome", { request_id: id, card_id: c.card_id, result: "accepted" });
      check("承諾（accepted）が通る", acc.status === 200, acc.text.slice(0, 80));
      let st = (await api.get(`/api/inbox/${id}/detail`)).data?.state;
      check("依頼の状態に承諾した人が出る", (st?.accepted_by ?? []).some((p) => p.name === c.name), JSON.stringify(st?.accepted_by ?? []));
      const cardsFile = readJson(path.join(presentDir, "cards.json"), null);
      const saved = JSON.stringify(cardsFile ?? "");
      check("置き場の cards.json に、その依頼の承諾が記録された", saved.includes(id) && saved.includes("accepted"));
      const again = await api.post("/api/outcome", { request_id: id, card_id: c.card_id, result: "accepted" });
      const hist = ((await api.get("/api/cards")).data?.cards ?? []).find((x) => x.card_id === c.card_id)?.outreach_history?.filter((h) => h.request_id === id && h.result === "accepted") ?? [];
      check("承諾を2回押しても、記録は1つ", again.status < 500 && hist.length === 1, `${hist.length}件`);
      const undo = await api.post("/api/outcome/undo", { request_id: id, card_id: c.card_id });
      check("承諾を取り消せる", undo.status === 200, undo.text.slice(0, 80));
      st = (await api.get(`/api/inbox/${id}/detail`)).data?.state;
      check("取り消したら、承諾した人がいなくなる", (st?.accepted_by ?? []).length === 0);
      const undo2 = await api.post("/api/outcome/undo", { request_id: id, card_id: c.card_id });
      check("承諾がないのに取り消すと 400", undo2.status === 400);
    }

    // ---- 4. 合言葉（見せる用）
    console.log("\n━ 合言葉（見せる用）");
    const anon = client(share.base);
    const noCode = await anon.get("/api/inbox");
    check("合言葉なしの窓口は 401", noCode.status === 401, String(noCode.status));
    const page = await anon.get("/");
    check("合言葉なしの画面は、合言葉の画面へ移す", page.status >= 300 && page.status < 400 && /\/access/.test(page.headers.get("location") ?? ""), `${page.status} ${page.headers.get("location")}`);
    const wrong = await anon.post("/api/access", { code: "chigau-aikotoba-0000" });
    check("違う合言葉は 401", wrong.status === 401);
    const right = await anon.post("/api/access", { code: ACCESS_CODE });
    const cookie = (right.headers.get("set-cookie") ?? "").split(";")[0];
    check("正しい合言葉で印（cookie）がもらえる", right.status === 200 && /=/.test(cookie));
    const withCookie = await client(share.base, { cookie }).get("/api/inbox");
    check("印があれば窓口が使える", withCookie.status === 200);
    const withHeader = await client(share.base, { "x-access-code": ACCESS_CODE }).get("/api/inbox");
    check("合言葉のヘッダーでも窓口が使える", withHeader.status === 200);
    check("見せる用は発表用と別の置き場（受信箱が空）", (withHeader.data?.items ?? []).every((x) => x.id !== id));

    // ---- 5. 予算の上限（見せる用、SHARE_BUDGET_USD）
    console.log("\n━ 予算の上限（見せる用）");
    const sh = client(share.base, { "x-access-code": ACCESS_CODE });
    const first = await sh.addAndWait(REQUEST_TEXT);
    check("上限までは使える（1件目の依頼が準備される）", first.detail?.status === "ready", `${first.detail?.status} ${first.detail?.error ?? ""}`);
    const shareUsage = readJson(path.join(shareDir, "usage.json"), []);
    const spent = (Array.isArray(shareUsage) ? shareUsage : shareUsage.records ?? []).reduce((n, e) => n + (e.cost_usd ?? 0), 0);
    check("見せる用の置き場に使った分が記録され、上限を超えた", spent > Number(BUDGET), `$${spent.toFixed(4)} ／上限 $${BUDGET}`);
    const c5 = fake.calls.length;
    const over = await sh.post("/api/inbox", { text: `${REQUEST_TEXT}（2件目）`, source: "manual" });
    check("上限を超えたら、API を使う操作を断る", over.status >= 400 && over.status < 500 && fake.calls.length === c5, `${over.status} ${(over.data?.error ?? "").slice(0, 60)}`);
    const read = await sh.get("/api/inbox");
    check("上限を超えても、見るだけの窓口は使える", read.status === 200);

    // ---- 6. 時間切れ（偽の API が返事をしない）
    console.log("\n━ 時間切れ");
    fake.setMode("hang");
    const t6 = Date.now();
    const hung = await api.addAndWait("「Timeout Night」運営です。2026年12月20日にLT5分の登壇をお願いできる方を探しています。", 90_000);
    fake.setMode("ok");
    const sec = Math.round((Date.now() - t6) / 1000);
    check("返事がなければ止めて、エラーにする（固まらない）", hung.detail?.status === "error", `${hung.detail?.status}（${sec}秒）`);
    check("使う人向けの文で、時間切れと分かる", /秒なかったので止めました|時間/.test(hung.detail?.error ?? ""), (hung.detail?.error ?? "").slice(0, 80));
    const after = await api.addAndWait("「Recovery Night」運営です。2026年12月22日にLT5分の登壇をお願いできる方を探しています。");
    check("時間切れのあとも、次の依頼は準備できる（枠が戻っている）", after.detail?.status === "ready", `${after.detail?.status} ${after.detail?.error ?? ""}`);
  } finally {
    await Promise.all([present?.stop(), share?.stop()]);
    await fake.close();
    check("リポジトリの data/ は変わっていない（書いたのは一時フォルダだけ）", gitData() === dataBefore);
    for (const d of [presentDir, shareDir]) fs.rmSync(d, { recursive: true, force: true });
    if (failed) console.log(`\nサーバーの記録：${logDir}`);
    else fs.rmSync(logDir, { recursive: true, force: true });
  }
  console.log(failed === 0 ? `\nすべて合格（${passed}件）` : `\n${failed}件 不合格（合格 ${passed}件）`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
