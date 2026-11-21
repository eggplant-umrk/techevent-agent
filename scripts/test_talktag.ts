// 登壇経験の印と、印と重なる注意点の取り除きのテスト（APIは使わない）。
//   npm run test:talktag
import fs from "node:fs";
import path from "node:path";
import { repeatsTalkTag, talkTag, withoutTalkTagRepeats } from "../lib/talkTag";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

// ---- 印 ----
check("登壇0回 → 初登壇", talkTag({ past_talk_count: 0, last_talk_date: null }, "2026-11-21") === "初登壇");
check("最後の登壇が183日以内 → 半年以内に登壇", talkTag({ past_talk_count: 3, last_talk_date: "2026-05-22" }, "2026-11-21") === "半年以内に登壇");
check("それより前 → 登壇経験あり", talkTag({ past_talk_count: 3, last_talk_date: "2025-11-01" }, "2026-11-21") === "登壇経験あり");

// ---- 印と同じことだけを言っている注意点は取り除く ----
const repeats = [
  "登壇経験なし（初登壇）",
  "登壇経験なし",
  "登壇は初めてです",
  "登壇経験はありません（初登壇）",
  "初登壇",
  "最後の登壇は2025年11月",
  "最近登壇した（2026-10-30）",
  "半年以内に登壇",
  "登壇経験あり（12回）",
];
for (const r of repeats) check(`除く：「${r}」`, repeatsTalkTag(r));

// ---- ほかのことも言っている注意点は残す ----
const keeps = [
  "登壇経験はなく、30分のセッションは初めて",
  "ネタ帳の記録は技術広報が未確認",
  "今後2週間は勤務時間の9割近くが予定で埋まっている",
  "予定が重なる（オフサイト 2027-01-27〜2027-01-29）",
  "初登壇なので、構成を事前に一緒に確認するとよい",
  "金融の障害事例なので、社外に出してよい範囲の確認が要る",
];
for (const k of keeps) check(`残す：「${k}」`, !repeatsTalkTag(k));

check(
  "並びは変えずに、重なるものだけ除く",
  JSON.stringify(withoutTalkTagRepeats(["登壇経験なし（初登壇）", "ネタ帳の記録は技術広報が未確認", "登壇は初めてです"])) === JSON.stringify(["ネタ帳の記録は技術広報が未確認"]),
);

// ---- 保存済みの実行結果（docs/eval_latest.json）で、重なりが残らないか ----
const latest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_latest.json"), "utf-8")) as {
  rows: Array<{ result: { candidates: Array<{ cautions: string[] }> } | null }>;
};
const all = latest.rows.flatMap((r) => r.result?.candidates ?? []).flatMap((c) => c.cautions);
const removed = all.filter(repeatsTalkTag);
const left = withoutTalkTagRepeats(all).filter((c) => /^(登壇経験なし|登壇は初めて|登壇経験はありません)/.test(c));
check("保存結果：印と同じだけの注意点を見つけて除ける", removed.length > 0 && left.length === 0, `${all.length}件中 ${removed.length}件を除く`);

console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
process.exit(failed ? 1 : 0);
