// API を使わないテストを、まとめて順に流す。テストの層の並びは docs/testing.md と scripts/test_layers.mjs
//   npm run test:unit       … ユニット層：scripts/test_*.ts を全部（= node scripts/test_all.mjs --unit）
//   npm run test:eval       … 評価層：結合テスト（scripts/eval.ts all --offline）（= --eval）
//   node scripts/test_all.mjs … 両方（前の npm test と同じ）
//   npm run test:unit -- inbox stage … 名前にその言葉が入るものだけ
// 1つでも失敗（終了コードが0以外）なら、最後に一覧を出して 1 で終わる。途中で止めず、全部流す。
// API・.env は使わない。各テストは scripts/_isolate.ts で一時フォルダを使うので、data/runtime/ と data/usage.json には書かない。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!fs.existsSync(tsx)) {
  console.error("node_modules がありません。先に npm install（または npm ci）をしてください");
  process.exit(1);
}

const filters = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const onlyUnit = process.argv.includes("--unit");
const onlyEval = process.argv.includes("--eval");
const jobs = [
  ...(onlyEval ? [] : fs
    .readdirSync(path.join(root, "scripts"))
    .filter((f) => /^test_.+\.ts$/.test(f))
    .sort()
    .map((f) => ({ name: f.replace(/\.ts$/, ""), args: [path.join("scripts", f)] }))),
  // 結合テスト（保存済みの結果をコードで判定。API は使わない）
  ...(onlyUnit ? [] : [{ name: "eval --offline", args: [path.join("scripts", "eval.ts"), "all", "--offline"] }]),
].filter((j) => !filters.length || filters.some((w) => j.name.includes(w)));

if (!jobs.length) {
  console.error(`当てはまるテストがありません：${filters.join(" ")}`);
  process.exit(1);
}

const results = [];
for (const j of jobs) {
  console.log(`\n━━ ${j.name} ━━`);
  const started = Date.now();
  // .env の設定に左右されないよう、見せ方・データの切り替えは外して流す（各テストが必要なら自分で入れる）
  const env = { ...process.env };
  for (const k of ["SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD", "BIND_HOST", "DATA_SOURCE", "DEMO_PERSON"]) delete env[k];
  const r = spawnSync(process.execPath, [tsx, ...j.args], { cwd: root, env, stdio: "inherit", timeout: 10 * 60_000 });
  results.push({ name: j.name, ok: r.status === 0, status: r.status, signal: r.signal, sec: ((Date.now() - started) / 1000).toFixed(1) });
}

console.log("\n━━ まとめ ━━");
for (const r of results) console.log(`${r.ok ? "○" : "×"} ${r.name}（${r.sec}秒）${r.ok ? "" : `：終了コード ${r.status ?? r.signal ?? "不明"}`}`);
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${results.length}本のうち ${failed.length}本が失敗：${failed.map((r) => r.name).join("、")}` : `\n${results.length}本すべて合格`);
process.exit(failed.length ? 1 : 0);
