// コピーボタン：navigator.clipboard が使えないページでもコピーでき、状態が進むこと（?mock。サーバーの API は使わない）
// 見せる用を IP アドレス（http://192.168.x.x:3100）で開くと、安全なページではないので navigator.clipboard がない。
// ここでは同じ状態を、ページを読む前に navigator.clipboard を消してまねる（lib/copyText.ts が古いやり方に切り替える）
import { expect, test, type Page } from "@playwright/test";
import { proceedWithFirstCandidate } from "./helpers";

/** navigator.clipboard をなくし、コピーの出来事で何がコピーされたかを window.__copied に残す。execFails なら古いやり方も失敗させる */
async function withoutClipboard(page: Page, execFails = false) {
  await page.addInitScript((fails) => {
    Object.defineProperty(Navigator.prototype, "clipboard", { get: () => undefined, configurable: true });
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    document.addEventListener("copy", () => {
      const a = document.activeElement as HTMLTextAreaElement | null;
      w.__copied.push(a && "value" in a ? a.value.slice(a.selectionStart ?? 0, a.selectionEnd ?? 0) : (document.getSelection()?.toString() ?? ""));
    });
    if (fails) document.execCommand = () => false;
  }, execFails);
}
const copied = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

async function openDraft(page: Page) {
  await page.goto("/?mock");
  expect(await page.evaluate(() => typeof navigator.clipboard), "navigator.clipboard がない状態").toBe("undefined");
  const row = page.getByRole("region", { name: "受信箱" }).getByRole("button", { name: /フロントエンド広場/ });
  await row.click();
  await expect(page.getByRole("region", { name: /^候補 \d+人$/ })).toBeVisible();
  const { draft } = await proceedWithFirstCandidate(page);
  await expect(row).toContainText("下書き中");
  return { row, draft };
}

test("?mock：navigator.clipboard がなくても、声かけ文・返事をコピーでき、「声かけ中」に進む", async ({ page }) => {
  await withoutClipboard(page);
  const { row, draft } = await openDraft(page);
  const subject = await draft.getByRole("textbox", { name: "件名" }).inputValue();
  const body = await draft.getByRole("textbox", { name: "本文" }).inputValue();

  // 声かけ文：コピーでき、状態が進む
  await draft.getByRole("button", { name: "声かけ文をコピー" }).click();
  await expect(draft.getByRole("button", { name: "コピーしました" })).toBeVisible();
  await expect(row).toContainText("声かけ中");
  expect(await copied(page)).toEqual([`${subject}\n\n${body}`]);
  await expect(page.getByText("Ctrl+C でコピーしてください")).toHaveCount(0);

  // 主催者への返事も同じボタンなので、同じようにコピーできる。入力欄のフォーカスは取らない（押したボタンに戻る）
  const reply = page.getByRole("region", { name: "主催者への返事（下書き）" });
  const replyText = await reply.getByRole("textbox").inputValue();
  expect(replyText).not.toBe("");
  await reply.getByRole("button", { name: "返事をコピー" }).click();
  await expect(reply.getByRole("button", { name: "コピーしました" })).toBeVisible();
  expect((await copied(page))[1]).toBe(replyText);
  // 画面の外に置いたテキスト欄は残さない
  await expect(page.locator('textarea[aria-hidden="true"]')).toHaveCount(0);
});

test("?mock：どの方法でもコピーできないときは、文を選んで「Ctrl+C でコピーしてください」と出し、状態は進めない", async ({ page }) => {
  await withoutClipboard(page, true);
  const { row, draft } = await openDraft(page);
  const subject = await draft.getByRole("textbox", { name: "件名" }).inputValue();
  const body = await draft.getByRole("textbox", { name: "本文" }).inputValue();

  await draft.getByRole("button", { name: "声かけ文をコピー" }).click();
  const manual = draft.getByRole("group", { name: "手でコピーする" });
  await expect(manual).toContainText("Ctrl+C でコピーしてください");
  const box = manual.getByRole("textbox", { name: "コピーする文" });
  await expect(box).toHaveValue(`${subject}\n\n${body}`);
  await expect(box).toBeFocused();
  // 文は全部選んである（そのまま Ctrl+C でコピーできる）
  expect(await box.evaluate((t: HTMLTextAreaElement) => [t.selectionStart, t.selectionEnd, t.value.length])).toEqual([0, `${subject}\n\n${body}`.length, `${subject}\n\n${body}`.length]);
  // コピーできていないので、「コピーしました」にも「声かけ中」にもならない
  await expect(draft.getByRole("button", { name: "コピーしました" })).toHaveCount(0);
  await expect(row).toContainText("下書き中");
  await expect(row).not.toContainText("声かけ中");
  await manual.getByRole("button", { name: "閉じる" }).click();
  await expect(manual).toHaveCount(0);
});
