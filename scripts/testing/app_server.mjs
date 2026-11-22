// 試験用に、本物のアプリのサーバーを立てる（API 層と E2E 層で使う）。
// - 3000番・3100番は使わない（発表用・見せる用とぶつからないように）。置き場は一時フォルダ
// - .env は使わない：アプリが読む環境変数の名前をソースから集めて、すべて空にしてから必要なものだけ入れる
//   （.env の読み込みは、すでにある環境変数を上書きしないため。本物のキー・Slack・カレンダーの URL が混ざらない）
// - API は偽の Anthropic（scripts/testing/fake_anthropic.mjs）に向ける。キーはにせもの
// - 本番用のビルド（next build）を使う。見せる用（合言葉）は scripts/serve.mjs start --share で、本物と同じ入口で立てる
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
export const FAKE_KEY = "sk-ant-fake-test-layers";
const FORBIDDEN_PORTS = new Set([3000, 3100]);

/** アプリ（lib・app・components・proxy・next.config・serve）が読む環境変数の名前 */
export function appEnvNames() {
  const names = new Set();
  const walk = (p) => {
    if (!fs.existsSync(p)) return;
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(p)) if (f !== "node_modules" && !f.startsWith(".")) walk(path.join(p, f));
      return;
    }
    if (!/\.(ts|tsx|mjs|js)$/.test(p)) return;
    for (const m of fs.readFileSync(p, "utf-8").matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
    for (const m of fs.readFileSync(p, "utf-8").matchAll(/process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g)) names.add(m[1]);
  };
  for (const p of ["lib", "app", "components", "proxy.ts", "next.config.ts", path.join("scripts", "serve.mjs")]) walk(path.join(ROOT, p));
  // Slack・API まわりで、ソースの外（SDK）が読むもの
  for (const n of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "CALENDAR_ICS_URL", "GITHUB_TOKEN"]) names.add(n);
  return [...names].sort();
}

/** 試験用の環境：アプリが読む名前はすべて空にし、偽の API と一時フォルダを入れる */
export function testEnv(fakeUrl, dir, extra = {}) {
  const env = { ...process.env };
  for (const n of appEnvNames()) env[n] = "";
  for (const k of Object.keys(env)) if (/^(SLACK_|ANTHROPIC_|NEXT_PUBLIC_)/.test(k)) env[k] = "";
  Object.assign(env, {
    ANTHROPIC_API_KEY: FAKE_KEY,
    ANTHROPIC_BASE_URL: fakeUrl,
    FIXED_TODAY: "2026-11-21",
    API_TIMEOUT_MS: "5000",
    NEXT_TELEMETRY_DISABLED: "1",
    DATA_RUNTIME_DIR: dir,
    INBOX_FILE: path.join(dir, "inbox.json"),
    SAMPLE_PROPOSALS_FILE: path.join(dir, "sample_proposals.json"),
    DRAFTS_FILE: path.join(dir, "drafts.json"),
    TALK_RECORD_FILE: path.join(dir, "talk_records.json"),
    PEOPLE_FILE: path.join(dir, "people.json"),
    SURVEY_IMPORT_DIR: path.join(dir, "survey_imports"),
    USAGE_FILE: path.join(dir, "usage.json"),
    ...extra,
  });
  return env;
}

export function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `techevent-${label}-`));
}

/**
 * 本番用のサーバー（npm start・npm run start:share = next start）がこの端末で動いているか。
 * next build は .next を作り直すので、同じ作業場所で本番用のサーバーが動いていると壊してしまう（開発サーバーの .next/dev は残る）。
 * どの作業場所のサーバーかはコマンドの行から分からないので、動いていれば止める（別の作業場所なら TEST_ALLOW_BUILD=1 で流せる）
 */
function productionServerRunning() {
  try {
    const out =
      process.platform === "win32"
        ? spawnSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.CommandLine }"], { encoding: "utf-8", timeout: 20_000 }).stdout
        : spawnSync("ps", ["-eo", "args"], { encoding: "utf-8" }).stdout;
    return (out ?? "").split(/\r?\n/).some((l) => /serve\.mjs"?\s+start\b|[\\/]next["']?\s+start\b/.test(l));
  } catch {
    return false;
  }
}

/** 本番用のビルド。SKIP_BUILD=1 なら、すでにある .next を使う */
export function buildApp(fakeUrl) {
  if (process.env.SKIP_BUILD === "1" && fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"))) return;
  if (process.env.TEST_ALLOW_BUILD !== "1" && productionServerRunning()) {
    throw new Error(
      "本番用のサーバー（npm start か npm run start:share）が動いているので、ビルドしません（同じ作業場所だと .next を作り直して壊すため）。" +
        "止めてから流すか、別の作業場所（worktree）で動いていると分かっているなら TEST_ALLOW_BUILD=1 を付けてください",
    );
  }
  const dir = tempDir("build");
  const next = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  console.log("本番用のビルド（next build）…");
  const r = spawnSync(process.execPath, [next, "build"], { cwd: ROOT, env: testEnv(fakeUrl, dir), stdio: ["ignore", "inherit", "inherit"], timeout: 10 * 60_000 });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`next build が失敗しました（終了コード ${r.status}）`);
}

/**
 * サーバーを立てて、応答するまで待つ。
 * profile：present（発表用。合言葉なし）／share（見せる用。合言葉・API 代の上限あり）
 */
export async function startApp({ profile = "present", port, fakeUrl, dir, extraEnv = {}, logFile = null }) {
  if (FORBIDDEN_PORTS.has(Number(port))) throw new Error(`${port}番は使いません（発表用・見せる用）`);
  const env =
    profile === "share"
      ? testEnv(fakeUrl, dir, { SHARE_PORT: String(port), SHARE_BIND_HOST: "127.0.0.1", SHARE_DATA_DIR: dir, ...extraEnv })
      : testEnv(fakeUrl, dir, { PORT: String(port), BIND_HOST: "127.0.0.1", ...extraEnv });
  const args = [path.join("scripts", "serve.mjs"), "start", ...(profile === "share" ? ["--share"] : [])];
  const out = logFile ? fs.openSync(logFile, "a") : "ignore";
  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ["ignore", out, out] });
  const base = `http://127.0.0.1:${port}`;
  const until = Date.now() + 90_000;
  let up = false;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`サーバーが起動しませんでした（${profile}、終了コード ${child.exitCode}）${logFile ? `。記録：${logFile}` : ""}`);
    up = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(3000) }).then(
      (r) => r.status < 500,
      () => false,
    );
    if (up) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) {
    child.kill();
    throw new Error(`サーバーが90秒で応答しませんでした（${profile}）`);
  }
  return {
    base,
    dir,
    child,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
        else child.kill("SIGTERM");
        setTimeout(resolve, 5000);
      }),
  };
}
