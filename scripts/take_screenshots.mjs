// スライドと README に使う画面の画像を撮る（docs/screenshots/）。本物の API は使わない。
//   1. 試し用のサーバーを立てる（3000・3100 以外。偽の API・一時フォルダ・本番用のビルド）
//        TEST_ALLOW_BUILD=1 E2E_PORT=3271 node scripts/testing/serve_for_e2e.mjs
//   2. SHOTS_BASE=http://127.0.0.1:3271 node scripts/take_screenshots.mjs [名前の一部…]
// 大きさは 1600×900。ブラウザの拡大 125% と同じ見え方（幅 1280 の画面を 1.25 倍で描く）。
// 画面の多くは ?mock（保存済みの結果）で撮る。「依頼ではない文で止まる」だけは偽の API のサーバーで撮る（?mock は種類を判定しないため）。
// 写さないもの：合言葉・/share-links・金額の合計（「この依頼の記録」の見出しの金額は撮るときだけ伏せる）
// 02b（候補日ごとの都合）だけは、本人の予定（12/14〜18 の終日の予定の iCal）を読ませたサーバーで撮る：
//        TEST_ALLOW_BUILD=1 node scripts/testing/serve_for_shots_dates.mjs
//        SHOTS_BASE=http://127.0.0.1:3271 node scripts/take_screenshots.mjs 02b
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.SHOTS_BASE || "http://127.0.0.1:3271";
const OUT = path.join(process.cwd(), "docs", "screenshots");
const only = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.25, locale: "ja-JP", timezoneId: "Asia/Tokyo" });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const shot = async (page, name) => {
  await page.waitForTimeout(400);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`撮った：docs/screenshots/${name}.png`);
};
const nav = (page, name) => page.getByRole("navigation", { name: "画面の切り替え" }).getByRole("button", { name, exact: true });
/** 見出しなどを画面の上の方に出す */
const toTop = async (loc, offset = 70) => {
  await loc.evaluate((el, off) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: "instant" }), offset);
};
const openX = async (page) => {
  await page.goto(`${BASE}/?mock`);
  await page.getByRole("region", { name: "受信箱" }).getByRole("button", { name: /フロントエンド広場/ }).click();
  await page.getByRole("region", { name: /^候補 \d+人$/ }).waitFor();
};

/** 候補日が3つある例の会話（架空） */
const CANDIDATE_DATES_CONV = [
  "@hayami_frontend",
  "LayerXさん、はじめまして！「Frontend Perf Night #4」を運営している早見です。Next.js での表示速度の改善事例をLTでお話しいただける方を探しています🙏",
  "",
  "@hayami_frontend",
  "日程は 12月15日（火）・12月17日（木）・1月14日（木）のどれかで考えています。いずれも19時から渋谷、現地のみ、LTは10分です。参加は40名ほどの予定です。",
  "",
  "@LayerX_tech",
  "ご連絡ありがとうございます！社内で話せそうな人に確認してみますね。",
].join("\n");

const SHOTS = {
  async "01_inbox_x_conversation_reading"(page) {
    await openX(page);
    await toTop(page.getByRole("heading", { name: "フロントエンド広場" }).first(), 150);
    await shot(page, "01_inbox_x_conversation_reading");
  },
  async "02_candidates_first_talk_reason_notes"(page) {
    await page.goto(`${BASE}/?mock`);
    await page.getByRole("region", { name: "受信箱" }).getByRole("button", { name: /Web Performance Night/ }).click();
    const first = page.getByRole("region", { name: /^候補 \d+人$/ }).getByRole("article").first();
    await first.waitFor();
    await toTop(first, 90);
    await shot(page, "02_candidates_first_talk_reason_notes");
  },
  // 偽の API ＋本人の予定のサーバー（serve_for_shots_dates.mjs）：候補日が3つある会話を貼って、候補日ごとの都合を出す
  async "02b_candidates_candidate_dates"(page) {
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "会話を貼って追加" }).click();
    await page.getByRole("textbox", { name: /会話を、そのまま貼って/ }).fill(CANDIDATE_DATES_CONV);
    await page.getByRole("button", { name: "受信箱に追加" }).click();
    const cands = page.getByRole("region", { name: /^候補 \d+人$/ });
    await cands.waitFor({ timeout: 90_000 });
    const days = page.getByLabel("候補日の都合").first();
    await days.waitFor();
    await toTop(cands, 80);
    await page.mouse.move(5, 300);
    await shot(page, "02b_candidates_candidate_dates");
  },
  async "03_outreach_draft_and_organizer_reply"(page) {
    await openX(page);
    const first = page.getByRole("region", { name: /^候補 \d+人$/ }).getByRole("article").first();
    await first.getByRole("button", { name: "この人で進める" }).click();
    const reply = page.getByRole("region", { name: "主催者への返事（下書き）" });
    await reply.getByRole("textbox").first().waitFor();
    await page.getByRole("region", { name: "声かけ文（下書き）" }).getByRole("textbox", { name: "本文" }).waitFor();
    await toTop(page.getByRole("region", { name: "声かけ文（下書き）" }), 90);
    await shot(page, "03a_outreach_draft");
    await toTop(reply, 90);
    await shot(page, "03b_organizer_reply_with_questions");
  },
  async "04_request_trace_timeline"(page) {
    await openX(page);
    await page.getByText("この依頼の記録", { exact: true }).first().click();
    const list = page.locator(".trace-list").first();
    await list.waitFor();
    // 金額は写さない（見出しの「合計 …・$…」の金額だけ、撮るときに伏せる）
    await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll("p.meta"))) {
        if (/^合計 /.test(el.textContent ?? "")) el.textContent = (el.textContent ?? "").replace(/・\$[\d.,]+/, "");
      }
    });
    await toTop(list, 180);
    await shot(page, "04_request_trace_timeline");
  },
  // 偽の API のサーバー（?mock なし）：貼った文を読み取り、依頼ではないと読んだら候補づくりを走らせずに止まる
  async "05_not_a_request_stopped"(page) {
    await page.goto(`${BASE}/`);
    await page.getByRole("button", { name: "会話を貼って追加" }).click();
    await page.getByRole("textbox", { name: /会話を、そのまま貼って/ }).fill("先日の勉強会、ありがとうございました！資料もとても分かりやすかったです。またご飯でも行きましょう。");
    await page.getByRole("button", { name: "受信箱に追加" }).click();
    await page.getByText("依頼ではなさそう").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(800);
    await shot(page, "05_not_a_request_stopped");
  },
  async "06_archive_survey_summary"(page) {
    await page.goto(`${BASE}/?mock`);
    await nav(page, "アーカイブ").click();
    const list = page.getByRole("region", { name: /^過去の依頼とイベント \d+件$/ });
    await list.getByRole("button", { name: /layerx\.go #17/ }).click();
    const neg = page.getByRole("heading", { name: /^改善点/ });
    await neg.waitFor();
    await toTop(neg, 100);
    await shot(page, "06a_archive_survey_complaints_next_themes");
    await toTop(page.getByRole("heading", { name: "カジュアル面談の希望" }), 100);
    await shot(page, "06b_archive_casual_interview");
  },
  async "07_notebook"(page) {
    await page.goto(`${BASE}/?mock`);
    await nav(page, "ネタ帳").click();
    const people = page.locator("section.notebook").first();
    await people.waitFor();
    // 人を1人開いて、右にその人のネタ・ブログ・最近の活動を出す
    await page.getByRole("searchbox", { name: "人を探す" }).fill("百瀬");
    await people.getByRole("button", { name: /^百瀬\s*結衣/ }).first().click();
    await page.getByRole("heading", { name: /^百瀬\s*結衣/ }).first().waitFor();
    await page.getByRole("searchbox", { name: "人を探す" }).fill("");
    await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
    await page.mouse.move(5, 300);
    await page.waitForTimeout(800);
    await shot(page, "07a_notebook_people");
    // いちばん上の切り替え（人｜アンケートの声｜担当者未定のネタ）で、アンケートの声を出す
    await page.getByRole("tablist", { name: "ネタ帳の表示" }).getByRole("tab", { name: /アンケートの声/ }).click();
    const voices = page.locator(".panel[aria-label=\"アンケートの声\"]").first();
    await voices.waitFor();
    await toTop(voices, 90);
    await shot(page, "07b_notebook_survey_voices");
  },
};

for (const [name, fn] of Object.entries(SHOTS)) {
  if (only.length && !only.some((o) => name.includes(o))) continue;
  const page = await context.newPage();
  try {
    await fn(page);
  } catch (e) {
    console.error(`撮れなかった：${name}（${e instanceof Error ? e.message.split("\n")[0] : e}）`);
    process.exitCode = 1;
  } finally {
    await page.close();
  }
}
await browser.close();
