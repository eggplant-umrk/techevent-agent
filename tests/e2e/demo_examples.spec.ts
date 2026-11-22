// 「会話を貼って追加」の「例を入れる」ボタン：押すと入力欄にその会話が入る。ほかの文が入っていたら、置き換えてよいかを小さく確かめる（窓は出さない）
// 中身は data/demo_conversations.json（ボタンの文字と会話）。発表用（偽の API のサーバー）と ?mock の両方で見る
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "demo_conversations.json"), "utf-8")) as {
  conversations: Array<{ id: string; label: string; text: string }>;
};
const [ex1, ex2, ex3] = data.conversations;

async function openPaste(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole("button", { name: "会話を貼って追加" }).click();
  const box = page.getByRole("textbox", { name: /会話を、そのまま貼って/ });
  await expect(box).toBeVisible();
  return box;
}

for (const url of ["/", "/?mock"]) {
  test(`例を入れる（${url}）：押すと入力欄に入る・ほかの文があれば確かめてから置き換える`, async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs++;
      void d.dismiss();
    });
    const box = await openPaste(page, url);
    const examples = page.getByRole("group", { name: "例を入れる" });
    // 3つのボタンが、ファイルの並びのとおりに出る。「架空の会話です」と書いてある
    for (const c of [ex1, ex2, ex3]) await expect(examples.getByRole("button", { name: c.label, exact: true })).toBeVisible();
    await expect(examples).toContainText("架空の会話です");

    // 空のときは、押すとすぐ入る
    await examples.getByRole("button", { name: ex1.label, exact: true }).click();
    await expect(box).toHaveValue(ex1.text);

    // ほかの文が入っているときは、置き換えてよいかを確かめる（窓は出さない）→「そのままにする」なら変わらない
    await examples.getByRole("button", { name: ex2.label, exact: true }).click();
    const confirm = examples.getByRole("status");
    await expect(confirm).toContainText(`「${ex2.label}」に置き換えますか？`);
    await confirm.getByRole("button", { name: "そのままにする" }).click();
    await expect(box).toHaveValue(ex1.text);
    await expect(confirm).toHaveCount(0);

    // 「置き換える」なら入る
    await examples.getByRole("button", { name: ex3.label, exact: true }).click();
    await examples.getByRole("status").getByRole("button", { name: "置き換える" }).click();
    await expect(box).toHaveValue(ex3.text);

    // 手で直した文も、置き換える前に確かめる
    await box.fill("自分で書いた依頼の文");
    await examples.getByRole("button", { name: ex2.label, exact: true }).click();
    await expect(examples.getByRole("status")).toBeVisible();
    await expect(box).toHaveValue("自分で書いた依頼の文");

    expect(dialogs, "確かめは窓（ダイアログ）を出さない").toBe(0);
  });
}
