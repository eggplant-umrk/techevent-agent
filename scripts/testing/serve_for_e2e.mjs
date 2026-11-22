// E2E 層（Playwright）用：偽の Anthropic と、本物のアプリ（本番用のビルド・発表用）を立てて、止められるまで動かす。
// playwright.config.ts の webServer から呼ぶ。3000番・3100番は使わない（既定 3211。E2E_PORT で変えられる）。置き場は一時フォルダ
//   node scripts/testing/serve_for_e2e.mjs
// 偽の API の呼び出しの記録は、E2E_FAKE_LOG（既定：置き場の fake_calls.log）に書く
import fs from "node:fs";
import path from "node:path";
import { buildApp, startApp, tempDir } from "./app_server.mjs";
import { startFakeAnthropic } from "./fake_anthropic.mjs";

const port = Number(process.env.E2E_PORT || 3211);
const dir = tempDir("e2e");
const fake = await startFakeAnthropic({ logFile: process.env.E2E_FAKE_LOG || path.join(dir, "fake_calls.log") });
buildApp(fake.url);
const app = await startApp({ profile: "present", port, fakeUrl: fake.url, dir, logFile: path.join(dir, "server.log") });
console.log(`e2e server ready on ${app.base}（置き場 ${dir}）`);

const stop = async () => {
  await app.stop();
  await fake.close();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
// 止められるまで待つ（Playwright は終わるときにこのプロセスを止める）
setInterval(() => undefined, 60_000);
