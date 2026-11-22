// デモの流れ（偽の API）：本物のサーバーが、偽の Anthropic（scripts/testing/fake_anthropic.mjs）を呼んで動く
// 貼る → 候補 → 声かけの下書き → 承諾 → アーカイブ → ネタ帳
import { expect, test } from "@playwright/test";
import { nav, openArchive, openPersonInNotebook, pasteConversation, proceedWithFirstCandidate, recordAccepted } from "./helpers";

const FAKE_TEXT_MARK = "試験用の偽の API";

test("偽の API：貼る→候補→声かけの下書き→承諾→アーカイブ→ネタ帳", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("banner")).not.toContainText("モック");
  const inbox = page.getByRole("region", { name: "受信箱" });

  // 貼る → 読み取り（偽の API）→ 候補（偽の API が、カードを見て提出する）
  const event = `E2E Night ${Date.now().toString(36)}`;
  await pasteConversation(page, `「${event}」運営の者です。2026年12月18日（金）19時〜、LT10分で登壇をお願いできる方を探しています。テーマは LLM の評価やテストです。`);
  await expect(page.getByRole("heading", { name: event, level: 3 })).toBeVisible({ timeout: 60_000 });
  const candidates = page.getByRole("region", { name: /^候補 \d+人$/ });
  await expect(candidates).toBeVisible({ timeout: 60_000 });
  await expect(candidates.getByRole("article").first()).toBeVisible();
  // 読み取った項目が出る（日程・形式は会話から、テーマは偽の API が読まないので未定）
  await expect(page.getByRole("definition").filter({ hasText: "2026-12-18" })).toBeVisible();
  await expect(inbox.getByRole("button", { name: new RegExp(event) })).toContainText("候補準備済み");

  // 声かけの下書き（偽の API の文が入る）→ 承諾
  const { name, draft } = await proceedWithFirstCandidate(page);
  await expect(draft.getByRole("textbox", { name: "本文" })).toHaveValue(new RegExp(FAKE_TEXT_MARK));
  await recordAccepted(page, name);
  await expect(inbox.getByRole("button", { name: new RegExp(event) })).toContainText(/承諾/);

  // 開き直しても承諾が残っている（サーバーに記録された）
  await page.reload();
  await page.getByRole("region", { name: "受信箱" }).getByRole("button", { name: new RegExp(event) }).click();
  await expect(page.getByRole("region", { name: "決まった人" })).toContainText(name);

  // アーカイブ → ネタ帳
  await openArchive(page);
  await openPersonInNotebook(page, name);
  await nav(page, "受信箱").click();
});
