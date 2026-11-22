// E2E 層（npm run test:e2e）：Playwright で、デモの流れを画面で通す。
// サーバーは scripts/testing/serve_for_e2e.mjs（偽の Anthropic ＋ 本物のアプリの本番用ビルド、3211番、置き場は一時フォルダ）。
// 3000番・3100番には触らない。本物の API は使わない。
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3211);
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  // 受信箱・カードの記録は1つのサーバーで共有するので、順に流す
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
  outputDir: "test-results",
  use: {
    baseURL: BASE,
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node scripts/testing/serve_for_e2e.mjs",
    url: `${BASE}/api/state`,
    // 本番用のビルドを含むので長め
    timeout: 10 * 60_000,
    reuseExistingServer: !process.env.CI,
    env: { E2E_PORT: String(PORT) },
    stdout: "pipe",
    stderr: "pipe",
  },
});
