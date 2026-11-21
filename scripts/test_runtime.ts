import "./_isolate"; // 元のデータだけで動かす（実行時のデータは一時フォルダ）
// 元のデータと、画面で触った結果（実行時のデータ data/runtime/）を分ける仕組みのテスト（APIは使わない）。
//   npm run test:runtime
import fs from "node:fs";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

const DATA = path.join(process.cwd(), "data");
const BASE_FILES = ["cards.json", "notebook_state.json", "notebook_progress.json", "unassigned_cards.json", path.join("sources", "demo-person", "cards.json")].map((f) => path.join(DATA, f));
const snapshot = () => BASE_FILES.map((f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf-8") : ""));

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  delete process.env.RELEASE_OWNERS_FILE;
  delete process.env.UNASSIGNED_CARDS_FILE;
  const before = snapshot();
  const rt = process.env.DATA_RUNTIME_DIR!;
  const { loadCards, baseCards, appendOutreach, editCard } = await import("../lib/cards");
  const runtime = await import("../lib/runtime");

  // ---- カード：中身が変わったカードだけを実行時のデータに書く
  const base = loadCards();
  check("最初は元のデータのカードだけ", JSON.stringify(base) === JSON.stringify(baseCards()) && !fs.existsSync(path.join(rt, "cards.json")));
  appendOutreach("card-e012-01", { request_id: "req001", result: "approved", reason: null, event_date: "2026-12-17" });
  const o1 = runtime.readCardOverlay<{ card_id: string; [k: string]: unknown }>();
  check("打診の記録をすると、そのカード1枚だけを実行時のデータに書く", o1.cards.length === 1 && o1.cards[0].card_id === "card-e012-01" && o1.deleted.length === 0);
  check("空の項目（evidence_request_ids・reactions など）は書かない", !["evidence_request_ids", "reactions", "pending_themes"].some((k) => Array.isArray(o1.cards[0][k]) && (o1.cards[0][k] as unknown[]).length === 0));
  check("読むときは元のデータに重なる（打診の記録が見える・ほかのカードはそのまま）", loadCards().find((c) => c.card_id === "card-e012-01")!.outreach_history.length === base.find((c) => c.card_id === "card-e012-01")!.outreach_history.length + 1 && loadCards().length === base.length);
  editCard("card-e013-01", { format_reason: "テスト用に直した理由" });
  check("別のカードを直すと、変わった2枚だけになる", runtime.readCardOverlay().cards.length === 2);
  check("元のデータのファイルは1バイトも変わらない", JSON.stringify(snapshot()) === JSON.stringify(before));

  // ---- 本人（e031）のカード：本人を入れていないときに保存しても消さない
  process.env.DEMO_PERSON = "on";
  editCard("card-e031-01", { format_reason: "本人のカードを直した" });
  check("DEMO_PERSON=on：本人のカードの変更も実行時のデータに入る", runtime.readCardOverlay<{ card_id: string }>().cards.some((c) => c.card_id === "card-e031-01"));
  delete process.env.DEMO_PERSON;
  check("off のときは本人のカードは見えない", !loadCards().some((c) => c.employee_id === "e031"));
  editCard("card-e013-01", { format_reason: "もう一度直した" });
  check("off のときに保存しても、本人のカードの変更は消えない", runtime.readCardOverlay<{ card_id: string }>().cards.some((c) => c.card_id === "card-e031-01"));
  process.env.DEMO_PERSON = "on";
  check("on に戻すと、本人のカードの変更が見える", loadCards().find((c) => c.card_id === "card-e031-01")?.format_reason === "本人のカードを直した");
  delete process.env.DEMO_PERSON;

  // ---- 読んだ記録（ネタ帳の更新）：元と違う人の分だけを書く
  const prep = await import("../lib/notebookPrep");
  prep.saveProgress("e012", new Set(["act001"]), null);
  const prog = JSON.parse(fs.readFileSync(path.join(rt, "notebook_progress.json"), "utf-8")) as Record<string, unknown>;
  check("読んだ記録は、変わった人の分だけを実行時のデータに書く", Object.keys(prog).join(",") === "e012");
  check("元の読んだ記録のファイルは変わらない", JSON.stringify(snapshot()) === JSON.stringify(before));

  // ---- 人の情報を直した結果も実行時のデータ
  const people = await import("../lib/people");
  const r = people.editPerson("e012", { ng_themes: ["テスト"] } as never);
  check("人の情報を直した結果は data/runtime/people.json", r.ok && fs.existsSync(path.join(rt, "people.json")));

  // ---- 片付ける対象
  check("npm run reset:demo の対象に、実行時のデータの置き場所が入る", runtime.resetTargets()[0] === rt);

  // 片付けると元のデータだけに戻る
  fs.rmSync(rt, { recursive: true, force: true });
  fs.mkdirSync(rt, { recursive: true });
  check("実行時のデータを片付けると、元のデータだけの初期状態に戻る", JSON.stringify(loadCards()) === JSON.stringify(base));
  check("最後まで元のデータのファイルは変わらない", JSON.stringify(snapshot()) === JSON.stringify(before));

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
