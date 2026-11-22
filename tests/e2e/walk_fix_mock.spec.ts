// 使ってみて見つかった点の直し（?mock）：未定はたたむ・「違う」の印と取り消し・下書き中 → コピーで声かけ中・戻っても下書きが出る
// サーバーの API は使わない（?mock は保存済みの結果だけで動く）
import { expect, test } from "@playwright/test";
import { proceedWithFirstCandidate } from "./helpers";

test("?mock：未定をたたむ・違うの印と取り消し・下書き中からコピーで声かけ中・戻っても下書きが出る", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?mock");
  const inbox = page.getByRole("region", { name: "受信箱" });
  const row = inbox.getByRole("button", { name: /フロントエンド広場/ });
  await row.click();
  const candidates = page.getByRole("region", { name: /^候補 \d+人$/ });
  await expect(candidates).toBeVisible();

  // 未定の項目はたたんであり、開けば見られる
  const undecided = page.locator("details.intake-undecided");
  await expect(undecided.locator("summary")).toContainText(/未定 \d+件/);
  await expect(undecided.locator("summary")).toContainText("主催者に聞き返します");
  await expect(undecided.getByRole("list", { name: "未定の項目" })).toBeHidden();
  await undecided.locator("summary").click();
  await expect(undecided.getByRole("list", { name: "未定の項目" })).toContainText("日程");

  // 「この候補は違う」→ 理由 → 印が付き、依頼を開き直しても残る → 取り消せる
  const second = candidates.getByRole("article").nth(1);
  await second.getByRole("button", { name: "この候補は違う" }).click();
  await second.getByRole("button", { name: "テーマが合わない" }).click();
  await expect(second).toContainText("違うと記録済み（テーマが合わない）");
  await inbox.getByRole("button", { name: /Web Performance Night/ }).click();
  await row.click();
  await expect(candidates.getByRole("article").nth(1)).toContainText("違うと記録済み（テーマが合わない）");
  await candidates.getByRole("article").nth(1).getByRole("button", { name: "取り消す" }).click();
  await expect(candidates.getByRole("article").nth(1).getByRole("button", { name: "この候補は違う" })).toBeVisible();
  await expect(candidates.getByRole("article").nth(1)).not.toContainText("違うと記録済み");

  // 「この人で進める」：下書きを作っただけなら「下書き中」（まだ声かけ中ではない）
  const { draft } = await proceedWithFirstCandidate(page);
  await expect(row).toContainText("下書き中");
  await expect(row).not.toContainText("声かけ中");
  const body = await draft.getByRole("textbox", { name: "本文" }).inputValue();

  // 候補に戻って開き直しても、前に作った下書きが出る（作り直さない）
  await page.getByRole("button", { name: "← 候補に戻る" }).click();
  const first = candidates.getByRole("article").first();
  await expect(first).toContainText("下書き中");
  await first.getByRole("button", { name: "下書きを開く" }).click();
  const again = page.getByRole("region", { name: "声かけ文（下書き）" });
  await expect(again.getByRole("textbox", { name: "本文" })).toHaveValue(body);
  await expect(page.getByRole("region", { name: "主催者への返事（下書き）" }).getByRole("textbox")).not.toHaveValue("");

  // 声かけ文をコピーしたら「声かけ中」になる
  await again.getByRole("button", { name: "声かけ文をコピー" }).click();
  await expect(row).toContainText("声かけ中");
  await page.getByRole("button", { name: "← 候補に戻る" }).click();
  await expect(candidates.getByRole("article").first().getByRole("button", { name: "返事を記録する" })).toBeVisible();
  // 声かけ中になってからも、開けば下書きが出る
  await candidates.getByRole("article").first().getByRole("button", { name: "返事を記録する" }).click();
  await expect(page.getByRole("region", { name: "声かけ文（下書き）" }).getByRole("textbox", { name: "本文" })).toHaveValue(body);
});
