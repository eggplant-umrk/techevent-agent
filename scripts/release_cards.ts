// リリースノートを「チームのネタ」としてカードにする（lib/releaseCards.ts）。
//   npm run release:cards -- --dry-run   # API を使わず、読むリリースノート・担当者・候補と、入力の大きさだけを出す
//   npm run release:cards                # API を使う（カードになっていないものだけ、1回の呼び出し＋差し戻し最大2回）
// 既存のカードは更新しない。担当者が決まらないものは「担当者未定のネタ」（data/unassigned_cards.json）になる。
import { employeeById } from "../lib/data";
import { pendingReleaseNotes, updateReleaseCards, type ReleaseEvent } from "../lib/releaseCards";

const dry = process.argv.includes("--dry-run");
if (!dry) process.loadEnvFile(".env");
delete process.env.DATA_SOURCE; // 架空の会社のデータで動かす
delete process.env.DEMO_PERSON; // デモ用の本人のカードのファイルには触らない

const pending = pendingReleaseNotes();
console.log(`カードになっていないリリースノート：${pending.length}件`);
for (const p of pending) {
  const who = p.owner
    ? `担当 ${p.owner} ${employeeById(p.owner)?.name ?? ""}`
    : p.candidates.length
      ? `担当者未定・候補 ${p.candidates.map((c) => `${c.employee_id}（${c.matched_keywords.join("/")}）`).join("、")}`
      : "担当者未定・候補なし";
  console.log(`  ${p.note.id} ${p.note.date} ${p.note.product}：${p.note.title.slice(0, 40)}｜${who}`);
}
if (dry) {
  const chars = pending.reduce((s, p) => s + p.note.summary.length + p.note.title.length + 80, 0) + 1500;
  console.log(`\n（API は使っていません）入力はおよそ ${chars}字。1回で済めば $0.05〜0.15 ほどの見込み`);
  process.exit(0);
}

function line(e: ReleaseEvent): string | null {
  switch (e.type) {
    case "start":
      return `model=${e.model}`;
    case "card":
      return `  カード ${e.card_id}（${e.employee_id} ${employeeById(e.employee_id)?.name ?? ""}、${e.by === "data" ? "担当者の記載あり" : e.by === "human" ? "割り当て済み" : "キーワード一致＋判断"}）：${e.theme}`;
    case "unassigned":
      return `  担当者未定のネタ ${e.card_id}：${e.theme}（${e.reason}）`;
    case "rejected":
      return `  ✗ 差し戻し：${e.errors.join(" / ")}`;
    case "error":
      return `  ! ${e.message}`;
    case "done":
      return `\n完了：カード${e.cards}・担当者未定${e.unassigned}／今回 $${e.run_usd.toFixed(3)}／累計 $${e.total_usd.toFixed(3)}`;
  }
}

updateReleaseCards((e) => {
  const s = line(e);
  if (s) console.log(s);
}).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
