// 候補づくりが終わった知らせ（?mock）：会話を貼ってほかのタブに移ると、終わったときに画面の端に知らせが出て、「開く」でその依頼が開く
// サーバーの API は使わない（?mock は保存済みの結果だけで動く。貼った会話は約10秒で「候補なし」になる）
import { expect, test } from "@playwright/test";
import { nav, pasteConversation } from "./helpers";

test("?mock：貼ってほかのタブへ → 終わったら知らせ → 開く", async ({ page }) => {
  await page.goto("/?mock");
  const inbox = page.getByRole("region", { name: "受信箱" });
  await expect(inbox.getByRole("listitem").first()).toBeVisible();
  const notices = page.getByRole("region", { name: "お知らせ" });
  // 最初から並んでいる準備済みの依頼では、知らせは出ない
  await expect(notices.getByRole("status")).toHaveCount(0);
  const before = await page.title();

  // 貼って、準備中のうちにネタ帳タブへ移る
  await pasteConversation(page, "「Toast Night」運営です。12月18日（金）19時〜、LT10分で登壇をお願いできる方を探しています。");
  await expect(inbox.getByRole("button", { name: /Toast Night|新しい依頼/ }).first()).toContainText("候補を準備中");
  await nav(page, "ネタ帳").click();
  await expect(inbox).toBeHidden();
  await expect(notices.getByRole("status")).toHaveCount(0);

  // 終わったら（モックは約10秒）、ネタ帳タブにいても知らせが出る。タブの題名の件数が1つ増える
  const notice = notices.getByRole("status").filter({ hasText: "Toast Night" });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await expect(notice).toContainText("準備が終わりました（合う候補は見つかりませんでした）");
  const count = (t: string) => Number(t.match(/^\((\d+)\)/)?.[1] ?? 0);
  await expect.poll(async () => count(await page.title())).toBe(count(before) + 1);

  // 「開く」で受信箱のその依頼が開き、知らせは消え、題名の件数も戻る
  await notice.getByRole("button", { name: "開く" }).click();
  await expect(inbox).toBeVisible();
  await expect(page.getByRole("heading", { name: "合う候補が見つかりませんでした" })).toBeVisible();
  await expect(notices.getByRole("status")).toHaveCount(0);
  await expect.poll(async () => count(await page.title())).toBe(count(before));
});

test("?mock：開いたまま待っているときは知らせを出さない。×で閉じられる", async ({ page }) => {
  await page.goto("/?mock");
  const inbox = page.getByRole("region", { name: "受信箱" });
  await expect(inbox.getByRole("listitem").first()).toBeVisible();
  const notices = page.getByRole("region", { name: "お知らせ" });

  // 貼ったまま（その依頼を開いたまま）待つ：終わっても知らせは出ない
  await pasteConversation(page, "「Stay Night」運営です。1月14日（木）19時〜、LT10分をお願いできる方を探しています。");
  await expect(page.getByRole("heading", { name: "合う候補が見つかりませんでした" })).toBeVisible({ timeout: 30_000 });
  await expect(notices.getByRole("status")).toHaveCount(0);

  // もう1件貼ってアーカイブへ：知らせが出て、×で閉じられる
  await pasteConversation(page, "「Close Night」運営です。1月21日（木）19時〜、LT10分をお願いできる方を探しています。");
  // 貼った依頼が開いて準備中になってから移る（開く前に移ると、開く処理が受信箱タブに戻す）
  await expect(inbox.getByRole("button", { name: /Close Night|新しい依頼/ }).first()).toContainText("候補を準備中");
  await nav(page, "アーカイブ").click();
  await expect(inbox).toBeHidden();
  const notice = notices.getByRole("status").filter({ hasText: "Close Night" });
  await expect(notice).toBeVisible({ timeout: 30_000 });
  await notice.getByRole("button", { name: "知らせを閉じる" }).click();
  await expect(notices.getByRole("status")).toHaveCount(0);
});
