// デモの流れ（?mock）：保存済みの結果だけで動く画面（サーバーの API を呼ばない）
// 貼る → 受信箱に入る（モックでは貼った会話は「候補なし」になる）→ 例の依頼「フロントエンド広場」で 候補 → 声かけの下書き → 承諾 → アーカイブ → ネタ帳
import { expect, test } from "@playwright/test";
import { nav, openArchive, openPersonInNotebook, pasteConversation, proceedWithFirstCandidate, recordAccepted } from "./helpers";

test("?mock：貼る→候補→声かけの下書き→承諾→アーカイブ→ネタ帳", async ({ page }) => {
  // サーバーの窓口（/api/…）への要求を記録する
  const apiCalls: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/")) apiCalls.push(`${r.method()} ${u.pathname} ＠ ${page.url()}`);
  });

  await page.goto("/?mock");
  await expect(page.getByRole("banner")).toContainText("モック");
  const inbox = page.getByRole("region", { name: "受信箱" });
  await expect(inbox.getByRole("listitem").first()).toBeVisible();

  // 貼る：受信箱の先頭に入り、準備中 → 準備済み（モックは約10秒）
  await pasteConversation(page, "「Mock Night」運営です。12月18日（金）19時〜、LT10分で登壇をお願いできる方を探しています。");
  const added = inbox.getByRole("button", { name: /Mock Night|新しい依頼/ }).first();
  await expect(added).toContainText("候補を準備中");
  await expect(page.getByRole("heading", { name: "合う候補が見つかりませんでした" })).toBeVisible({ timeout: 30_000 });

  // 候補：例の依頼（貼った会話の例）を開く
  await inbox.getByRole("button", { name: /フロントエンド広場/ }).click();
  await expect(page.getByRole("region", { name: /^候補 \d+人$/ })).toBeVisible();

  // 声かけの下書き → 承諾
  const { name, draft } = await proceedWithFirstCandidate(page);
  await expect(draft.getByRole("textbox", { name: "件名" })).not.toHaveValue("");
  await expect(page.getByRole("region", { name: "主催者への返事（下書き）" }).getByRole("textbox")).not.toHaveValue("");
  await recordAccepted(page, name);

  // 受信箱の一覧でも承諾済みになる
  await expect(inbox.getByRole("button", { name: /フロントエンド広場/ })).toContainText(/承諾/);

  // アーカイブ → ネタ帳
  await openArchive(page);
  await openPersonInNotebook(page, name);
  await nav(page, "受信箱").click();
  await expect(inbox).toBeVisible();

  // モックは、元のデータを GET の窓口で読むだけ（app/_client/mock.ts）。書き込み・API を使う操作（POST など）はサーバーに送らない
  expect(apiCalls.filter((c) => !c.startsWith("GET ")), "モックでは /api に書き込まない（API を使わない）").toEqual([]);
});
