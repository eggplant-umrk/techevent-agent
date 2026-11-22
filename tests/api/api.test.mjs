// API 層の試験（npm run test:api）：本物のサーバーを立てて、窓口に本当に要求を投げる。返り値と、置き場（一時フォルダ）の変化を確かめる。
// - API は偽の Anthropic（scripts/testing/fake_anthropic.mjs）。本物の API は使わない。Slack には投稿しない
// - サーバーは本番用のビルドで、3201番（発表用）と3202番・3203番（見せる用）。3000番・3100番は使わない（TEST_API_PORT で始まりを変えられる）
// - 置き場は一時フォルダ。終わったら消す。リポジトリの data/ が変わっていないことも確かめる
// - SKIP_BUILD=1 なら、すでにある .next を使う（続けて流すとき）
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  const share2Dir = tempDir("api-share2");
  let present;
  let share;
  let share2;
  try {
    [present, share, share2] = await Promise.all([
      startApp({ profile: "present", port: PORT, fakeUrl: fake.url, dir: presentDir, logFile: path.join(logDir, "present.log") }),
      startApp({ profile: "share", port: PORT + 1, fakeUrl: fake.url, dir: shareDir, logFile: path.join(logDir, "share.log"), extraEnv: { ACCESS_CODE, SHARE_BUDGET_USD: BUDGET } }),
      // 見せる用で2人が同時に使う試験用（上限は余裕を持たせ、待ちは短く）
      startApp({ profile: "share", port: PORT + 2, fakeUrl: fake.url, dir: share2Dir, logFile: path.join(logDir, "share2.log"), extraEnv: { ACCESS_CODE, SHARE_BUDGET_USD: "5", API_SLOT_WAIT_MS: "300" } }),
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

    // ---- 1b. 続きの会話を貼ると、件数が増えずに同じ依頼が更新される
    console.log("\n━ 続きの会話で同じ依頼を更新する");
    const countBefore = ((await api.get("/api/inbox")).data?.items ?? []).filter((x) => /^inb-/.test(x.id)).length;
    const MORE = `${REQUEST_TEXT}\n\n追伸です。会場は渋谷で、参加は40名ほどの予定です。よろしくお願いします。`;
    const cont = await api.post("/api/inbox", { text: MORE, source: "manual" });
    check("続きを貼る：同じ依頼の id と continued: true が返る", cont.status === 200 && cont.data?.id === id && cont.data?.continued === true, `${cont.status} ${cont.text.slice(0, 120)}`);
    let contDetail = null;
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      contDetail = (await api.get(`/api/inbox/${id}/detail`)).data;
      if (contDetail && contDetail.status !== "processing") break;
    }
    const countAfter = ((await api.get("/api/inbox")).data?.items ?? []).filter((x) => /^inb-/.test(x.id)).length;
    check("続きを貼る：受信箱の件数は増えない", countAfter === countBefore, `${countBefore} → ${countAfter}`);
    check("続きを貼る：会話が新しいものに差し替わり、準備済みに戻る", contDetail?.status === "ready" && contDetail?.text === MORE, `${contDetail?.status} ${contDetail?.error ?? ""}`);
    check("続きを貼る：変わった項目の一覧（コードで比べた結果）が付く", Array.isArray(contDetail?.last_update?.changes), JSON.stringify(contDetail?.last_update ?? null).slice(0, 200));
    check("続きを貼る：候補は残っている", (contDetail?.result?.candidates?.length ?? 0) >= 1);
    const asNew = await api.post("/api/inbox", { text: `${MORE}\n\nもう1件、別の回のご相談です。`, source: "manual", as_new: true });
    check("「新しい依頼として追加」（as_new）なら、別の依頼として入る", asNew.status === 200 && /^inb-/.test(asNew.data?.id ?? "") && asNew.data?.id !== id && !asNew.data?.continued, asNew.text.slice(0, 120));

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

    // ---- 7. 受信箱の「もう一度探す」（受信箱で準備し直し、受信箱に保存する）
    console.log("\n━ 受信箱の「もう一度探す」");
    const waitReady = async (rid, maxMs = 60_000) => {
      const until = Date.now() + maxMs;
      let d = null;
      while (Date.now() < until) {
        await sleep(400);
        d = (await api.get(`/api/inbox/${rid}/detail`)).data;
        if (d && d.status !== "processing") break;
      }
      return d;
    };
    const inboxItem = (rid) => {
      const f = readJson(path.join(presentDir, "inbox.json"), []);
      return (Array.isArray(f) ? f : f.items ?? []).find((x) => x.id === rid);
    };
    const hungId = hung.add.data?.id;
    const c7 = fake.calls.length;
    // 準備中のあいだに2回目を押せるように、この試験のあいだだけ偽の API の返事を遅らせる
    // （機械が混んでいると、遅らせないと2回目が届く前に準備が終わってしまい、409 にならないことがあった）
    fake.setDelay(3000);
    let rs;
    let rsAgain;
    let stillProcessing;
    try {
      rs = await api.post(`/api/inbox/${hungId}/restart`);
      rsAgain = await api.post(`/api/inbox/${hungId}/restart`);
      stillProcessing = (await api.get(`/api/inbox/${hungId}/detail`)).data?.status;
    } finally {
      fake.setDelay(0);
    }
    check("エラーの依頼で「もう一度探す」：窓口が受け付ける", rs.status === 200 && rs.data?.ok === true, `${rs.status} ${rs.text.slice(0, 80)}`);
    check("準備中にもう一度押すと 409（二重に走らせない）", rsAgain.status === 409, `${rsAgain.status}（2回目のあとの状態：${stillProcessing}）`);
    const rd = await waitReady(hungId);
    check("エラーだった依頼が、準備し直して ready になる", rd?.status === "ready" && !rd?.error, `${rd?.status} ${rd?.error ?? ""}`);
    check("準備し直しで、候補を探すループを呼んだ", fake.calls.slice(c7).some((x) => x.kind === "loop"));
    const rc = rd?.result?.candidates ?? [];
    const savedItem = inboxItem(hungId);
    check("結果が受信箱（inbox.json）に保存される", savedItem?.status === "ready" && rc.length >= 1 && (savedItem?.result?.candidates ?? []).length === rc.length, `${savedItem?.status} 候補${(savedItem?.result?.candidates ?? []).length}人`);
    if (rc[0]) {
      const go = await api.post("/api/outcome", { request_id: hungId, card_id: rc[0].card_id, result: "approved" });
      check("準備し直した候補で「この人で進める」が通る", go.status === 200, go.text.slice(0, 80));
      const dr = await api.post("/api/draft", { request_id: hungId, run_id: rd.result.run_id, candidate: { employee_id: rc[0].employee_id } });
      check("その人の下書きまで作れる（保存済みの候補から引き直せる）", dr.status === 200 && !!dr.data?.draft, `${dr.status} ${dr.text.slice(0, 80)}`);
    }
    const rsReady = await api.post(`/api/inbox/${id}/restart`);
    const rd2 = await waitReady(id);
    check("準備済みの依頼でも「もう一度探す」で準備し直して保存する", rsReady.status === 200 && rd2?.status === "ready" && (inboxItem(id)?.result?.candidates ?? []).length >= 1, `${rsReady.status} ${rd2?.status}`);
    check("受信箱にない依頼は 404", (await api.post("/api/inbox/inb-nai/restart")).status === 404);

    // ---- 8. 見せる用で2人が同時に使う（置き場所が混ざらない・1人1件まで）
    console.log("\n━ 見せる用で2人が同時に使う");
    const keyOf = (v) => createHash("sha256").update(`netacho-person:${v}`).digest("hex").slice(0, 32);
    const login = async () => {
      const r = await fetch(`${share2.base}/api/access`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: ACCESS_CODE }) });
      const jar = (r.headers.getSetCookie?.() ?? []).map((x) => x.split(";")[0]).join("; ");
      const v = /nb_person=([^;]+)/.exec(jar)?.[1] ?? null;
      return { jar, key: v ? keyOf(v) : null };
    };
    const p1 = await login();
    const p2 = await login();
    check("2人が別の人の印をもらう", !!p1.key && !!p2.key && p1.key !== p2.key);
    const u1 = client(share2.base, { cookie: p1.jar });
    const u2 = client(share2.base, { cookie: p2.jar });
    // それぞれの受信箱に依頼を1件ずつ（受信箱は人ごとの場所）
    const [i1, i2] = await Promise.all([u1.addAndWait(`${REQUEST_TEXT}（人1）`), u2.addAndWait(`${REQUEST_TEXT}（人2）`)]);
    const id1 = i1.add.data?.id;
    const id2 = i2.add.data?.id;
    check("2人とも自分の受信箱に依頼を入れて、準備が終わる", i1.detail?.status === "ready" && i2.detail?.status === "ready", `${i1.detail?.status} ${i2.detail?.status}`);
    const v1 = path.join(share2Dir, "visitors", p1.key ?? "x");
    const v2 = path.join(share2Dir, "visitors", p2.key ?? "y");
    const steps = (v, rid) => (readJson(path.join(v, "traces", `${rid}.json`), null)?.steps ?? []).length;
    const before1 = steps(v1, id1);
    const before2 = steps(v2, id2);
    // 流しながら返す窓口（候補を出す → 分析）を、2人が同時に使う（1人1件なので、1人の中では順に）。
    // 人を Next.js の要求から決められていなければ、別の場所（no-person）を読んで「依頼が見つかりません」になる
    const chain = async (u, rid) => {
      const a = await u.post("/api/agent", { request_id: rid });
      const n = await u.post("/api/events/ev015/analyze");
      return [a, n];
    };
    const [[a1, n1], [a2, n2]] = await Promise.all([chain(u1, id1), chain(u2, id2)]);
    const errOf = (r) => r.data?.error ?? r.text.split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((e) => e?.type === "error")?.message ?? null;
    const okStream = (r) => r.status === 200 && !errOf(r);
    check("2人とも、自分の依頼で候補を出せる（流しながら返す窓口が、その人の受信箱を読む）", okStream(a1) && okStream(a2), `${a1.status} ${a2.status} ${errOf(a1) ?? ""} ${errOf(a2) ?? ""}`);
    check("2人とも分析を流せる", n1.status === 200 && n2.status === 200, `${n1.status} ${n2.status} ${(n1.data?.error ?? n2.data?.error ?? "").slice(0, 60)}`);
    check("人1の実行の記録は人1の場所だけに足される", steps(v1, id1) > before1 && !fs.existsSync(path.join(v2, "traces", `${id1}.json`)), `${before1}→${steps(v1, id1)}`);
    check("人2の実行の記録は人2の場所だけに足される", steps(v2, id2) > before2 && !fs.existsSync(path.join(v1, "traces", `${id2}.json`)), `${before2}→${steps(v2, id2)}`);
    const ids = (v) => {
      const f = readJson(path.join(v, "inbox.json"), []);
      return (Array.isArray(f) ? f : f?.items ?? []).map((x) => x.id);
    };
    check("受信箱も混ざらない（人1の場所に人2の依頼がない・その逆も）", ids(v1).includes(id1) && !ids(v1).includes(id2) && ids(v2).includes(id2) && !ids(v2).includes(id1));
    check("人の印のない場所（no-person）に書かない", !fs.existsSync(path.join(share2Dir, "visitors", "no-person")));
    const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => !f.startsWith(".")).sort().join(",") : "（なし）");
    check("2人の場所に、同じ種類の記録ができる（分析の記録も、それぞれの場所に）", list(v1) === list(v2), `人1:${list(v1)} ／ 人2:${list(v2)}`);
    const baseLeft = fs.readdirSync(share2Dir).filter((f) => !["visitors", "usage.json", "person_usage.json"].includes(f));
    check("見せる用の置き場の直下には、人の場所と金額の記録のほかに書かない", baseLeft.length === 0, baseLeft.join(","));
    // 1人1件まで：人1の依頼の準備が終わらない間（偽の API が返事をしない）、人1の2件目は待ってから断る。人2は始められる
    fake.setMode("hang");
    const h1 = await u1.post("/api/inbox", { text: "「Slot Night」運営です。2026年12月24日にLT5分の登壇をお願いできる方を探しています。", source: "manual" });
    const h1b = await u1.post("/api/inbox", { text: "「Slot Night 2」運営です。2026年12月25日にLT5分の登壇をお願いできる方を探しています。", source: "manual" });
    const h2 = await u2.post("/api/inbox", { text: "「Slot Night 3」運営です。2026年12月26日にLT5分の登壇をお願いできる方を探しています。", source: "manual" });
    check("見せる用：1人目の1件目は受け付ける", h1.status === 200 && !!h1.data?.id, `${h1.status} ${h1.text.slice(0, 60)}`);
    check("見せる用：同じ人の2件目は、1件目が動いている間は断る（理由はこの端末の1件）", h1b.status === 429 && /この端末/.test(h1b.data?.error ?? ""), `${h1b.status} ${(h1b.data?.error ?? "").slice(0, 60)}`);
    check("見せる用：ほかの人は、その間も始められる（全体は6件まで）", h2.status === 200 && !!h2.data?.id, `${h2.status} ${(h2.data?.error ?? "").slice(0, 60)}`);
    await sleep(6_000); // 時間切れ（5秒）で枠が返るのを待ってから止める
    fake.setMode("ok");
  } finally {
    await Promise.all([present?.stop(), share?.stop(), share2?.stop()]);
    await fake.close();
    check("リポジトリの data/ は変わっていない（書いたのは一時フォルダだけ）", gitData() === dataBefore);
    for (const d of [presentDir, shareDir, share2Dir]) fs.rmSync(d, { recursive: true, force: true });
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
