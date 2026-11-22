// 「会話を貼って追加」の「例を入れる」ボタン：押すと入力欄にその会話が入る。ほかの文が入っていたら、置き換えてよいかを小さく確かめる（窓は出さない）
// 例3（例2の続き）は、受信箱に例2の依頼があるときだけ押せる（ないときは薄くして「例2を入れると使えます」）
// 中身は data/demo_conversations.json（ボタンの文字と会話）。発表用（偽の API のサーバー）と ?mock の両方で見る
import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "demo_conversations.json"), "utf-8")) as {
  conversations: Array<{ id: string; label: string; text: string; requires?: string }>;
};
const [ex1, ex2, ex3] = data.conversations;

async function openPaste(page: Page) {
  await page.getByRole("button", { name: "会話を貼って追加" }).click();
  const box = page.getByRole("textbox", { name: /会話を、そのまま貼って/ });
  await expect(box).toBeVisible();
  return box;
}
const examplesOf = (page: Page) => page.getByRole("group", { name: "例を入れる" });

for (const url of ["/", "/?mock"]) {
  test(`例を入れる（${url}）：押すと入力欄に入る・ほかの文があれば確かめてから置き換える`, async ({ page }) => {
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs++;
      void d.dismiss();
    });
    await page.goto(url);
    const box = await openPaste(page);
    const examples = examplesOf(page);
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
    await examples.getByRole("button", { name: ex2.label, exact: true }).click();
    await examples.getByRole("status").getByRole("button", { name: "置き換える" }).click();
    await expect(box).toHaveValue(ex2.text);

    // 手で直した文も、置き換える前に確かめる
    await box.fill("自分で書いた依頼の文");
    await examples.getByRole("button", { name: ex1.label, exact: true }).click();
    await expect(examples.getByRole("status")).toBeVisible();
    await expect(box).toHaveValue("自分で書いた依頼の文");

    expect(dialogs, "確かめは窓（ダイアログ）を出さない").toBe(0);
  });
}

test("例3（?mock）：例2がないと押せない → 例2を入れると押せる", async ({ page }) => {
  await page.goto("/?mock");
  await openPaste(page);
  const examples = examplesOf(page);
  const b3 = examples.getByRole("button", { name: ex3.label, exact: true });
  // 例2がないとき：薄くて押せない。下に「例2を入れると使えます」。例1・例2は押せる
  await expect(b3).toBeDisabled();
  await expect(examples).toContainText("例2を入れると使えます");
  await expect(b3).toHaveAccessibleDescription("例2を入れると使えます");
  await expect(examples.getByRole("button", { name: ex1.label, exact: true })).toBeEnabled();
  await expect(examples.getByRole("button", { name: ex2.label, exact: true })).toBeEnabled();

  // 例2を入れて受信箱に追加する
  await examples.getByRole("button", { name: ex2.label, exact: true }).click();
  await page.getByRole("button", { name: "受信箱に追加" }).click();
  // 受信箱に入った（モックの題名は会話の1行目。並びは受け取った時刻の順なので、先頭とは限らない）
  await expect(page.getByRole("region", { name: "受信箱" })).toContainText(/infra_study_tokyo|Infra Study Tokyo/);

  // もう一度「会話を貼って追加」を開くと、例3が押せる。押すと入る
  const box = await openPaste(page);
  await expect(b3).toBeEnabled();
  await expect(examples).not.toContainText("例2を入れると使えます");
  await b3.click();
  await expect(box).toHaveValue(ex3.text);
});

test("例3（発表用・偽の API）：例2を受信箱に入れると押せる（受信箱の一覧の demo_ids で判断）", async ({ page }) => {
  await page.goto("/");
  await openPaste(page);
  const examples = examplesOf(page);
  const b3 = examples.getByRole("button", { name: ex3.label, exact: true });
  // 例2がまだ受信箱にないなら、押せない（ほかの試験が先に入れていれば、もう押せる）
  const before = (await (await page.request.get("/api/inbox")).json()) as { items: Array<{ demo_ids?: string[] }> };
  const had = before.items.some((x) => x.demo_ids?.includes(ex2.id));
  if (!had) {
    await expect(b3).toBeDisabled();
    await expect(examples).toContainText("例2を入れると使えます");
  }
  await examples.getByRole("button", { name: ex2.label, exact: true }).click();
  await page.getByRole("button", { name: "受信箱に追加" }).click();
  const after = (await (await page.request.get("/api/inbox")).json()) as { items: Array<{ demo_ids?: string[] }> };
  expect(after.items.some((x) => x.demo_ids?.includes(ex2.id)), "受信箱の一覧に例2の印がある").toBe(true);
  await openPaste(page);
  await expect(b3).toBeEnabled();
});
