// E2E の共通の操作。画面の要素は役割（role）と見える文字で探す（クラス名・見た目の変更で壊れにくくするため）
import { expect, type Page } from "@playwright/test";

export const nav = (page: Page, name: "受信箱" | "ネタ帳" | "アーカイブ") =>
  page.getByRole("navigation", { name: "画面の切り替え" }).getByRole("button", { name, exact: true });

/** 「会話を貼って追加」から会話を貼り、受信箱に入れる */
export async function pasteConversation(page: Page, text: string) {
  await page.getByRole("button", { name: "会話を貼って追加" }).click();
  await page.getByRole("textbox", { name: /会話を、そのまま貼って/ }).fill(text);
  await page.getByRole("button", { name: "受信箱に追加" }).click();
}

/** 候補の1人目で「この人で進める」→ 声かけ文の下書きが出るまで */
export async function proceedWithFirstCandidate(page: Page) {
  const first = page.getByRole("region", { name: /^候補 \d+人$/ }).getByRole("article").first();
  // 候補の名前は、カード（article）の名前（アクセシビリティ上の名前）から読む
  const name = (await first.ariaSnapshot()).match(/^- article "([^"]+)"/)?.[1] ?? "";
  expect(name, "候補のカードに名前がある").not.toBe("");
  await first.getByRole("button", { name: "この人で進める" }).click();
  await expect(page.getByRole("region", { name: /さんで進める|進める人/ })).toContainText(`${name.trim()}さんで進める`);
  const draft = page.getByRole("region", { name: "声かけ文（下書き）" });
  await expect(draft.getByRole("textbox", { name: "本文" })).not.toHaveValue("", { timeout: 60_000 });
  return { name: name.trim(), draft };
}

/** 「承諾」を記録して、「決まった人」に出るまで */
export async function recordAccepted(page: Page, name: string) {
  await page.getByRole("region", { name: "結果の記録" }).getByRole("button", { name: "承諾", exact: true }).click();
  const decided = page.getByRole("region", { name: "決まった人" });
  await expect(decided).toContainText(name);
  await expect(decided).toContainText("承諾済み");
}

/** アーカイブを開いて、過去のイベントを1つ開く */
export async function openArchive(page: Page) {
  await nav(page, "アーカイブ").click();
  const list = page.getByRole("region", { name: /^過去の依頼とイベント \d+件$/ });
  await expect(list).toBeVisible();
  const firstEvent = list.getByRole("button").first();
  await expect(firstEvent).toBeVisible();
  await firstEvent.click();
  await expect(page.getByRole("heading", { name: "登壇", level: 3 })).toBeVisible();
}

/** ネタ帳で人を探して開き、その人の記録に承諾が残っているかを見る */
export async function openPersonInNotebook(page: Page, name: string) {
  await nav(page, "ネタ帳").click();
  // 人の一覧の見出しは「人 30人」、絞り込むと「人 1 / 30人」
  const people = page.getByRole("region", { name: /^人 (\d+ \/ )?\d+人$/ });
  await expect(people).toBeVisible();
  await page.getByRole("searchbox", { name: "人を探す" }).fill(name.split(/\s/)[0]);
  const who = new RegExp(`^${name.replace(/\s+/g, "\\s*")}`);
  await people.getByRole("button", { name: who }).first().click();
  await expect(page.getByRole("heading", { name: who }).first()).toBeVisible();
  // 承諾がその人の記録（カードの打診履歴）に残っている
  await expect(page.getByRole("main")).toContainText("承諾済みの依頼あり");
}
