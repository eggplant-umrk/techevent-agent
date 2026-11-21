// CLI for "ネタ帳を更新".
//   npm run notebook -- e001,e011        # these employees
//   npm run notebook -- pending          # employees with new activities
// Uses API credits. The key is read from .env into this process only.
import { updateNotebook, type NotebookEvent } from "../lib/notebook";

process.loadEnvFile(".env");

function line(e: NotebookEvent): string | null {
  switch (e.type) {
    case "start":
      return `model=${e.model} targets=${e.targets.length}`;
    case "employee":
      return `[${e.n}/${e.of}] ${e.employee_id} ${e.name}（活動${e.activity_count}件）`;
    case "card":
      return `   ${e.action === "created" ? "新規" : e.action === "updated" ? "更新" : "確認済みのため保持"} ${e.card_id}：${e.theme}`;
    case "rejected":
      return `   ✗ 保存せず：${e.errors.join(" / ")}`;
    case "no_card":
      return `   カードなし：${e.note}`;
    case "error":
      return `   ! ${e.message}`;
    case "done":
      return `\n完了：新規${e.created} 更新${e.updated} 保持${e.kept}／今回 $${e.run_usd.toFixed(3)}／累計 $${e.total_usd.toFixed(3)}`;
    default:
      return null;
  }
}

const arg = process.argv[2] ?? "";
const targets = arg === "pending" ? "pending" : arg.split(",").filter(Boolean);
if (targets !== "pending" && targets.length === 0) {
  console.error("使い方: npm run notebook -- e001,e011 | pending");
  process.exit(1);
}
updateNotebook(targets, (e) => {
  const s = line(e);
  if (s) console.log(s);
}).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
