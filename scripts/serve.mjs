// 開発サーバー・本番サーバーの起動（npm run dev ／ npm start）。待ち受け先と見せ方の設定を .env から読む。
//   BIND_HOST：待ち受け先（既定 127.0.0.1。SHARE_MODE=lan で空なら、この端末の LAN の IP）
//   SHARE_MODE=lan のときは ACCESS_CODE（合言葉）が必須。空なら起動しない
//   既定（SHARE_MODE なし）で BIND_HOST に localhost 以外を書いたら起動しない（合言葉なしで外に開かないため）
// 合言葉の値は表示しない。
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const mode = process.argv[2] === "start" ? "start" : "dev";
const extra = process.argv.slice(3);
try {
  process.loadEnvFile(".env");
} catch {
  // .env がなくても、既定（localhost だけ）で起動する
}

const shareRaw = (process.env.SHARE_MODE ?? "").trim().toLowerCase();
const share = shareRaw === "lan" ? "lan" : "local";
const fail = (msg) => {
  console.error(`起動しません：${msg}`);
  process.exit(1);
};
if (shareRaw && shareRaw !== "lan" && shareRaw !== "local") fail(`SHARE_MODE は lan か空（既定）です（今は「${shareRaw}」）`);
if (share === "lan" && !(process.env.ACCESS_CODE ?? "").trim())
  fail("SHARE_MODE=lan のときは .env に ACCESS_CODE（合言葉）を設定してください。合言葉なしでは起動しません");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return null;
}
let host = (process.env.BIND_HOST ?? "").trim();
if (!host) host = share === "lan" ? lanAddress() ?? fail("この端末の LAN の IP が見つかりません。.env の BIND_HOST に書いてください") : "127.0.0.1";
if (share === "local" && !LOOPBACK.has(host)) fail(`BIND_HOST=${host} は localhost ではありません。別の端末からつなぐときは SHARE_MODE=lan と ACCESS_CODE を設定してください`);

const port = process.env.PORT || "3000";
console.log(
  share === "lan"
    ? `見せる設定（SHARE_MODE=lan）：http://${host}:${port} で待ち受けます。開いた人は合言葉を入れます${process.env.SHARE_BUDGET_USD ? `。API 代の上限 $${process.env.SHARE_BUDGET_USD}` : ""}`
    : `http://${host}:${port} で待ち受けます（この端末からだけ）`,
);
const next = path.join("node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [next, mode, "-H", host, ...extra], {
  stdio: "inherit",
  env: { ...process.env, SHARE_STARTED_AT: new Date().toISOString() },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
