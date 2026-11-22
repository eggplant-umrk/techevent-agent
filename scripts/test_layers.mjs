// テストの層を順に流す（並びと役割は docs/testing.md）。
//   npm test      … unit → api → eval（ユニット・API・評価）
//   npm run test:all … unit → api → e2e → eval（E2E は時間がかかるので、こちらだけに入れる）
//   npm test -- inbox stage … 前と同じく、名前にその言葉が入るユニットのテストだけ（ほかの層は流さない）
// 1つの層が失敗しても、残りの層は流す（どこが壊れたかを一度に見るため）。最後に層ごとの結果を出し、1つでも失敗なら 1 で終わる。
// API 層と E2E 層は本番用のビルドを使うので、最初に1回だけビルドして、両方で使い回す（SKIP_BUILD=1）。
import { spawnSync } from "node:child_process";
import path from "node:path";
import { buildApp } from "./testing/app_server.mjs";

const args = process.argv.slice(2);
const LAYERS = {
  unit: { label: "1. ユニット", cmd: ["scripts/test_all.mjs", "--unit"] },
  api: { label: "2. API", cmd: ["tests/api/api.test.mjs"] },
  e2e: { label: "3. E2E", cmd: [path.join("node_modules", "@playwright", "test", "cli.js"), "test"] },
  // ④の offline の評価が入ったら、ここ（と package.json の test:eval）を差し替える
  eval: { label: "4. 評価", cmd: ["scripts/test_all.mjs", "--eval"] },
};
const wanted = args.filter((a) => a in LAYERS);
const filters = args.filter((a) => !(a in LAYERS) && !a.startsWith("-"));

// 名前を指定したときは、前の npm test と同じく、ユニット（と評価）のテストを名前で選んで流すだけ
if (filters.length) {
  const r = spawnSync(process.execPath, ["scripts/test_all.mjs", ...filters], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const results = [];
const env = { ...process.env };
if (wanted.includes("api") || wanted.includes("e2e")) {
  const t = Date.now();
  try {
    buildApp("http://127.0.0.1:1"); // API の宛先はサーバーの起動時に決まるので、ビルドには関係しない
    env.SKIP_BUILD = "1";
    results.push({ label: "0. 本番用のビルド", ok: true, sec: ((Date.now() - t) / 1000).toFixed(0) });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    results.push({ label: "0. 本番用のビルド", ok: false, sec: ((Date.now() - t) / 1000).toFixed(0) });
  }
}
for (const key of wanted) {
  const layer = LAYERS[key];
  console.log(`\n━━━━━━━━ ${layer.label} ━━━━━━━━`);
  const t = Date.now();
  const needsBuild = key === "api" || key === "e2e";
  if (needsBuild && results.some((r) => r.label.startsWith("0.") && !r.ok)) {
    results.push({ label: layer.label, ok: false, sec: "0", note: "ビルドに失敗したので流していません" });
    continue;
  }
  const r = spawnSync(process.execPath, layer.cmd, { stdio: "inherit", env, timeout: 20 * 60_000 });
  results.push({ label: layer.label, ok: r.status === 0, sec: ((Date.now() - t) / 1000).toFixed(0) });
}

console.log("\n━━━━━━━━ 層ごとの結果 ━━━━━━━━");
for (const r of results) console.log(`${r.ok ? "○" : "×"} ${r.label}（${r.sec}秒）${r.note ? `：${r.note}` : ""}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n失敗：${failed.map((r) => r.label).join("、")}` : "\nすべての層が合格");
process.exit(failed.length ? 1 : 0);
