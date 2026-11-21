// サーバーの起動（npm run dev ／ npm start ／ npm run start:share）。設定は .env から読む。合言葉の値は表示しない。
//
// 発表用（npm run dev／npm start）：この端末だけ（127.0.0.1:3000）。データは今までの置き場（data/runtime/ など）
//   - .env に SHARE_MODE=lan があっても、発表用は合言葉なし・この端末だけで起動する（見せる用は start:share で別に立てる）
//   - BIND_HOST・PORT で変えられる。ただし BIND_HOST は localhost だけ
// 見せる用（npm run start:share）：同じネットワークの全員に URL と合言葉を公開する前提
//   - SHARE_MODE=lan・0.0.0.0:3100（SHARE_BIND_HOST・SHARE_PORT で変えられる）
//   - データは別の置き場（SHARE_DATA_DIR、既定 data/runtime-share/）。受信箱・下書き・分析・金額の記録もここに分ける
//   - ACCESS_CODE（合言葉）と SHARE_BUDGET_USD（API 代の上限）が必須。どちらかが空なら起動しない
//   - 本番用のビルド（npm run build のあと）だけ。開発サーバーでは立てない（発表用と .next がぶつかるため）
// --print-config：起動せずに、決まった設定（合言葉は伏せる）を表示して終わる（テスト・確認用）
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const mode = process.argv[2] === "start" ? "start" : "dev";
const args = process.argv.slice(3);
const shareProfile = args.includes("--share");
const printOnly = args.includes("--print-config");
const extra = args.filter((a) => a !== "--share" && a !== "--print-config");
try {
  process.loadEnvFile(".env");
} catch {
  // .env がなくても、発表用（この端末だけ）で起動する
}

const fail = (msg) => {
  console.error(`起動しません：${msg}`);
  process.exit(1);
};
const env = { ...process.env, SHARE_STARTED_AT: new Date().toISOString() };
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

let host;
let port;
if (shareProfile) {
  if (mode !== "start") fail("見せる用は本番用のビルドで立てます。npm run build のあと npm run start:share を使ってください");
  if (!(process.env.ACCESS_CODE ?? "").trim()) fail("見せる用には .env の ACCESS_CODE（合言葉）が必要です。合言葉なしでは起動しません");
  const budget = Number((process.env.SHARE_BUDGET_USD ?? "").trim());
  if (!(Number.isFinite(budget) && budget > 0)) fail("見せる用には .env の SHARE_BUDGET_USD（見せている間の API 代の上限、例：5）が必要です。上限なしでは起動しません");
  host = (process.env.SHARE_BIND_HOST ?? "").trim() || "0.0.0.0";
  port = (process.env.SHARE_PORT ?? "").trim() || "3100";
  const dir = path.resolve((process.env.SHARE_DATA_DIR ?? "").trim() || path.join("data", "runtime-share"));
  Object.assign(env, {
    SHARE_MODE: "lan",
    DATA_RUNTIME_DIR: dir,
    INBOX_FILE: path.join(dir, "inbox.json"),
    SAMPLE_PROPOSALS_FILE: path.join(dir, "sample_proposals.json"),
    DRAFTS_FILE: path.join(dir, "drafts.json"),
    TALK_RECORD_FILE: path.join(dir, "talk_records.json"),
    PEOPLE_FILE: path.join(dir, "people.json"),
    SURVEY_IMPORT_DIR: path.join(dir, "survey_imports"),
    USAGE_FILE: path.join(dir, "usage.json"),
  });
} else {
  if ((process.env.SHARE_MODE ?? "").trim().toLowerCase() === "lan")
    console.warn("（.env の SHARE_MODE=lan は使いません。発表用はこの端末だけで起動します。見せる用は npm run start:share）");
  env.SHARE_MODE = "";
  host = (process.env.BIND_HOST ?? "").trim() || "127.0.0.1";
  port = (process.env.PORT ?? "").trim() || "3000";
  if (!LOOPBACK.has(host)) fail(`BIND_HOST=${host} は localhost ではありません。別の端末に見せるときは npm run start:share で見せる用を別に立ててください`);
}
env.PORT = port;

if (printOnly) {
  const pick = ["SHARE_MODE", "DATA_RUNTIME_DIR", "INBOX_FILE", "SAMPLE_PROPOSALS_FILE", "DRAFTS_FILE", "TALK_RECORD_FILE", "PEOPLE_FILE", "SURVEY_IMPORT_DIR", "USAGE_FILE", "SHARE_BUDGET_USD"];
  const shown = Object.fromEntries(pick.map((k) => [k, env[k] ?? ""]));
  console.log(JSON.stringify({ profile: shareProfile ? "share" : "present", mode, host, port, access_code_set: !!(env.ACCESS_CODE ?? "").trim(), ...shown }));
  process.exit(0);
}

const lanIps = Object.values(os.networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a.address);
console.log(
  shareProfile
    ? `見せる用（SHARE_MODE=lan）：http://${host === "0.0.0.0" ? lanIps[0] ?? host : host}:${port} で待ち受けます。開いた人は合言葉を入れます。API 代の上限 $${env.SHARE_BUDGET_USD}。データは ${path.relative(process.cwd(), env.DATA_RUNTIME_DIR)}`
    : `発表用：http://${host}:${port} で待ち受けます（この端末からだけ）`,
);
const next = path.join("node_modules", "next", "dist", "bin", "next");
const portArgs = extra.some((a) => a === "-p" || a === "--port" || a.startsWith("--port=")) ? [] : ["-p", port];
const child = spawn(process.execPath, [next, mode, "-H", host, ...portArgs, ...extra], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
