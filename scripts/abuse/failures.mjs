// いじわる試験（途中の失敗）：偽の API（scripts/abuse/fake_api.mjs）につないだ確認用のサーバーに投げる。本物の API は使わない。
//   node scripts/abuse/failures.mjs <モードを書くファイル> <呼び出しの記録ファイル> [http://127.0.0.1:3200] [試験の名前…]
// 試験：errors（429・529・500・JSON でない返事）／slots（同時に3件）／hang（返事が来ないまま。再起動の試験の準備）
import fs from "node:fs";
const [modeFile, logFile, baseArg, ...only] = process.argv.slice(2);
const BASE = baseArg || "http://127.0.0.1:3200";
if (/:(3000|3100)(\/|$)/.test(BASE)) process.exit(1);
const want = (n) => !only.length || only.includes(n);
const setMode = (m) => fs.writeFileSync(modeFile, m);
const calls = () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean).length : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (name, v) => console.log(JSON.stringify({ test: name, ...v }));
const post = (path, body, signal) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
const get = async (path) => (await fetch(BASE + path)).json();
const TEXT = "「Failure Test Night」運営の者です。12月18日（金）19時〜、LT10分をお願いできる方を探しています。";

/** 受信箱に入れて、準備が終わる（か時間切れ）まで待つ */
async function addAndWait(label, maxMs) {
  const before = calls();
  const t = Date.now();
  const id = (await (await post("/api/inbox", { text: `${TEXT}（${label}）`, source: "manual" })).json()).id;
  let d;
  while (Date.now() - t < maxMs) {
    await sleep(1000);
    d = await get(`/api/inbox/${id}/detail`);
    if (d.status !== "processing") break;
  }
  return { id, status: d?.status, stage: d?.state?.stage, error: d?.error ?? null, seconds: Math.round((Date.now() - t) / 1000), api_calls: calls() - before, log_errors: (d?.events ?? []).filter((e) => e.type === "error").map((e) => e.message) };
}

if (want("errors")) {
  for (const m of ["429", "529", "500", "badjson"]) {
    setMode(m);
    out(`受信箱に追加（偽の API が ${m} を返す）`, await addAndWait(m, 90_000));
  }
  // 画面の「ネタ帳から候補を出す」（作業ログを流す窓口）と、下書き
  setMode("529");
  let t = Date.now();
  let res = await post("/api/agent", { request_id: "req002" });
  let body = await res.text();
  out("候補を出す（529）", { status: res.status, seconds: Math.round((Date.now() - t) / 1000), last_lines: body.trim().split("\n").slice(-2).map((l) => l.slice(0, 200)) });
  out("候補を出すのに失敗したあと、前の候補は残るか", { candidates: ((await get("/api/inbox/req002/detail")).result?.candidates ?? []).length });
  t = Date.now();
  res = await post("/api/draft", { run_id: "abuse", request_id: "req002", candidate: { employee_id: "e013", theme: "LLM の評価", reason: "取り組みがある", evidence_activity_ids: [] } });
  out("下書き（529）", { status: res.status, seconds: Math.round((Date.now() - t) / 1000), body: (await res.text()).slice(0, 200) });
  t = Date.now();
  res = await post("/api/notebook", {});
  body = await res.text();
  out("ネタ帳を更新（529）", { status: res.status, seconds: Math.round((Date.now() - t) / 1000), last_lines: body.trim().split("\n").slice(-2).map((l) => l.slice(0, 200)) });
}

if (want("slots")) {
  // 返事が来ない状態で、作業ログを流す窓口を3件同時に。2件まで通り、3件目が断られるはず
  setMode("hang");
  const ac = new AbortController();
  const started = [1, 2, 3].map(() => post("/api/agent", { request_id: "req003" }, ac.signal).then((r) => r.status).catch((e) => `中断(${e.name})`));
  await sleep(6000);
  const third = await Promise.race([Promise.all(started), sleep(100).then(() => "まだ応答待ち")]);
  // 応答の頭（ステータス）は流し始めに返るので、少し待てば3件とも分かる
  const st = await Promise.race([Promise.all(started), sleep(3000).then(() => null)]);
  out("候補を出すを3件同時（返事が来ない API）", { statuses: st ?? third });
  // 4件目（受信箱への追加）は通るか
  const r4 = await post("/api/inbox", { text: `${TEXT}（slots）`, source: "manual" });
  out("同時に2件動いている間の、受信箱への追加", { status: r4.status, body: (await r4.text()).slice(0, 120) });
  // 受信箱への追加を3件同時（裏の候補づくりは数に入るか）
  const rs = await Promise.all([1, 2, 3].map((i) => post("/api/inbox", { text: `${TEXT}（slots-${i}）`, source: "manual" }).then((r) => r.status)));
  out("受信箱への追加を3件同時（返事が来ない API）", { statuses: rs });
  ac.abort(); // タブを閉じたのと同じ
  await sleep(1500);
  const after = await post("/api/agent", { request_id: "req003" }, AbortSignal.timeout(4000)).then((r) => r.status).catch((e) => `応答待ちのまま(${e.name})`);
  out("タブを閉じたあと、枠は戻るか", { status: after });
}

if (want("hang")) {
  setMode("hang");
  const id = (await (await post("/api/inbox", { text: `${TEXT}（hang）`, source: "manual" })).json()).id;
  await sleep(5000);
  const d = await get(`/api/inbox/${id}/detail`);
  out("返事が来ない API（5秒後）", { id, status: d.status, stage: d.state?.stage });
}
