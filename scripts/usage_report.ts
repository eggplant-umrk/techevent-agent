// 使った API 代を見る（API は使わない）。見せる前後の確認用。
//   npm run usage              累計・今日（日本時間）・用途ごと（今日）
//   npm run usage -- 3         直近3時間（見せていた間など）
import { usage } from "../lib/data";

const hours = Number(process.argv[2]);
const all = usage();
const jstDate = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
const today = jstDate(new Date().toISOString());
const sum = (xs: typeof all) => xs.reduce((n, e) => n + e.cost_usd, 0);
const todays = all.filter((e) => jstDate(e.at) === today);

console.log(`累計：$${sum(all).toFixed(3)}（${all.length}回）`);
console.log(`今日（${today}）：$${sum(todays).toFixed(3)}（${todays.length}回）`);
const byPurpose = new Map<string, number>();
for (const e of todays) byPurpose.set(e.purpose, (byPurpose.get(e.purpose) ?? 0) + e.cost_usd);
for (const [p, v] of [...byPurpose].sort((a, b) => b[1] - a[1])) console.log(`  ${p}：$${v.toFixed(3)}`);
if (Number.isFinite(hours) && hours > 0) {
  const since = Date.now() - hours * 3600_000;
  const recent = all.filter((e) => Date.parse(e.at) >= since);
  console.log(`直近${hours}時間：$${sum(recent).toFixed(3)}（${recent.length}回）`);
}
