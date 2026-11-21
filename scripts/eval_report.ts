// Build docs/eval_after.md from docs/eval_before.json (v0.1) and docs/eval_after.json (v0.2).
//   npx tsx scripts/eval_report.ts
// No API calls.
import fs from "node:fs";
import path from "node:path";

type Cand = { employee_id: string; name: string; theme: string };
type Row = {
  request_id: string;
  pattern: string;
  top3: string[];
  expected: string[];
  any_hit: boolean;
  primary_hit: boolean;
  alternative_ok: boolean | null;
  run_usd: number;
  steps: number;
  result: { candidates: Cand[]; no_fit?: { reasons: string[]; next_checks: string[] } | null; learnings_applied?: string[] } | null;
};
type Score = { employee_id: string; specificity: number; grounded: number; fit: number; appeal: number; comment: string };

const root = process.cwd();
const before = JSON.parse(fs.readFileSync(path.join(root, "docs", "eval_before.json"), "utf-8")) as { at: string; spent_usd: number; rows: Row[] };
const after = JSON.parse(fs.readFileSync(path.join(root, "docs", "eval_after.json"), "utf-8")) as {
  at: string;
  spent_usd: number;
  pass_rate: number;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
  rows: Row[];
  coverage: { covered: number; total: number; missing: string[] } | null;
  writeback: { declined: string; before: string[]; after: string[]; learnings_applied: string[]; run_usd: number } | null;
  quality: Array<{ request_id: string; before: number; after: number; before_scores: Score[]; after_scores: Score[] }> | null;
};
const names = new Map(
  (JSON.parse(fs.readFileSync(path.join(root, "data", "employees.json"), "utf-8")) as Array<{ id: string; name: string }>).map((e) => [e.id, e.name]),
);
const nm = (id: string) => `${id} ${names.get(id) ?? ""}`;
const ok = (b: boolean | null | undefined) => (b === null || b === undefined ? "—" : b ? "○" : "×");
const f2 = (n: number) => n.toFixed(2);
const sign = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const sc = (s: Score) => (s.specificity + s.grounded + s.fit + s.appeal) / 4;

let md = `# 評価結果 v0.2（after）と v0.1（before）の比較

- before：${before.at}（v0.1：依頼ごとに毎回探すAgent）→ [eval_before.md](eval_before.md)
- after：${after.at}（v0.2：ネタ帳Agent）／生データ [eval_after.json](eval_after.json)
- 判定に使う想定候補は data/README.md から評価スクリプトだけが読む（Agentには渡していない）
- 作り直すとき：\`npm run eval -- all --report docs/eval_after.md\` のあと \`npx tsx scripts/eval_report.ts\`

## 比較表

| 依頼 | パターン | before 上位 | after 上位 | 想定のいずれか（前→後） | 代わりの提案（前→後） | 呼び出し（前→後） | 金額（前→後） |
|---|---|---|---|---|---|---|---|
`;
for (const a of after.rows) {
  const b = before.rows.find((x) => x.request_id === a.request_id)!;
  md += `| ${a.request_id} | ${a.pattern} | ${b.top3.map(nm).join("<br>")} | ${a.top3.map(nm).join("<br>") || "（なし）"}${a.result?.no_fit ? "<br>※3人未満" : ""} | ${ok(b.any_hit)} → ${ok(a.any_hit)} | ${ok(b.alternative_ok)} → ${ok(a.alternative_ok)} | ${b.steps} → ${a.steps} | $${b.run_usd.toFixed(3)} → $${a.run_usd.toFixed(3)} |\n`;
}
const bAvg = avg(before.rows.map((r) => r.run_usd));
const aAvg = avg(after.rows.map((r) => r.run_usd));
md += `\n1件あたりの平均：before $${bAvg.toFixed(3)} → after $${aAvg.toFixed(3)}（呼び出し ${f2(avg(before.rows.map((r) => r.steps)))} → ${f2(avg(after.rows.map((r) => r.steps)))} 回）。after の金額には、指名の依頼で Fable が書く「代わりの人を推す理由」も含む。\n`;

md += `\n## 段階1：結合テスト（コードで判定、90%未満で失敗）\n\n結果：**${after.checks.filter((c) => c.pass).length}/${after.checks.length}（${Math.round(after.pass_rate * 100)}%）${after.pass_rate >= 0.9 ? "合格" : "不合格"}**\n\n| 判定 | 項目 | 内容 |\n|---|---|---|\n`;
for (const c of after.checks) md += `| ${ok(c.pass)} | ${c.name} | ${c.detail.replace(/\|/g, "／")} |\n`;

if (after.coverage) {
  md += `\n### ネタ帳のカード化\n\n未発信の取り組み ${after.coverage.total}件のうち **${after.coverage.covered}件** が未発信のカードの根拠に入った（基準は15件以上。ブログ済み・登壇済みのカードは数えない）。\n`;
}
if (after.writeback) {
  const w = after.writeback;
  md += `\n### 書き戻し\n\n${nm(w.declined)} のカードに「辞退：忙しい」を書き戻して同じ依頼（req003）をもう一度流した。\n\n- 前：${w.before.map(nm).join("、")}\n- 後：${w.after.map(nm).join("、") || "（なし）"}\n- Agentが書いた反映内容：${w.learnings_applied.join("／") || "（なし）"}\n- テスト後に打診履歴は元に戻している\n`;
}

if (after.quality) {
  md += `\n## 段階2：テーマ案の質（LLMで採点）\n\n同じ審査（claude-opus-5-5、effort low）で before と after を別々に採点した。各候補を「具体性・根拠との一致・依頼への適合・聴衆への魅力」の4項目×1〜5点で採点し、その平均を出している。\n\n| 依頼 | before 平均 | after 平均 | 差 | before 1位 | after 1位 | 1位の差 |\n|---|---|---|---|---|---|---|\n`;
  const allB: number[] = [];
  const allA: number[] = [];
  const topB: number[] = [];
  const topA: number[] = [];
  for (const q of after.quality) {
    const b1 = q.before_scores[0] ? sc(q.before_scores[0]) : 0;
    const a1 = q.after_scores[0] ? sc(q.after_scores[0]) : 0;
    allB.push(...q.before_scores.map(sc));
    allA.push(...q.after_scores.map(sc));
    topB.push(b1);
    topA.push(a1);
    md += `| ${q.request_id} | ${f2(q.before)} | ${f2(q.after)} | ${sign(q.after - q.before)} | ${f2(b1)} | ${f2(a1)} | ${sign(a1 - b1)} |\n`;
  }
  md += `| **全体** | **${f2(avg(allB))}** | **${f2(avg(allA))}** | **${sign(avg(allA) - avg(allB))}** | **${f2(avg(topB))}** | **${f2(avg(topA))}** | **${sign(avg(topA) - avg(topB))}** |\n`;
  md += `\n候補数は before ${allB.length}人、after ${allA.length}人。after は合う人がいなければ3人そろえないので、平均には「弱い2〜3位を出さなくなった」効果も入っている。1位だけを比べた列のほうが、テーマ案そのものの差に近い。\n`;
  md += `\n### 採点のコメント（after）\n`;
  for (const q of after.quality) {
    md += `\n**${q.request_id}**\n`;
    for (const s of q.after_scores) md += `- ${nm(s.employee_id)}（${f2(sc(s))}）：${s.comment}\n`;
  }
}

md += `\n## 3人未満になった依頼\n`;
for (const a of after.rows.filter((r) => r.result?.no_fit)) {
  md += `\n**${a.request_id}**（${a.top3.length}人）\n- 見つからない理由：${a.result!.no_fit!.reasons.join("／")}\n- 次に確認すべきこと：${a.result!.no_fit!.next_checks.join("／")}\n`;
}

md += `\n## 金額\n\n- before の評価全体：$${before.spent_usd.toFixed(3)}\n- after の評価全体（5件＋書き戻しの再実行＋採点）：$${after.spent_usd.toFixed(3)}\n`;

fs.writeFileSync(path.join(root, "docs", "eval_after.md"), md);
console.log("wrote docs/eval_after.md");
