// 記録を写す（npm run save:session）と、写したものから評価のケースの候補を作る（npm run eval:from-feedback -- <場所>）のテスト。
//   npx tsx scripts/test_save_session.ts（npm test にも入る）。API は使わない・data/ に書き込まない（一時フォルダだけ）
import "./_isolate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "save-session-"));
const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
const run = (script: string, args: string[], env: Record<string, string>) => {
  const clean = { ...process.env };
  for (const k of ["SHARE_MODE", "DATA_RUNTIME_DIR", "INBOX_FILE", "USAGE_FILE", "SAMPLE_PROPOSALS_FILE", "SHARE_DATA_DIR"]) delete clean[k];
  return spawnSync(process.execPath, [tsx, path.join("scripts", script), ...args], { env: { ...clean, ...env }, encoding: "utf-8" });
};
const line = (o: object) => JSON.stringify(o) + "\n";
const fbRow = (id: string, rid: string, target_id: string) =>
  line({ id, at: "2026-11-22T10:00:00+09:00", request_id: rid, target: "candidate", target_id, verdict: "good", reason_code: "good", note: "連絡は taro@example.com" });

try {
  const sessions = path.join(tmp, "sessions");
  // ---- 発表用
  const rt = path.join(tmp, "runtime");
  fs.mkdirSync(path.join(rt, "traces"), { recursive: true });
  fs.writeFileSync(path.join(rt, "feedback.jsonl"), fbRow("fb-1", "req001", "e001"));
  fs.writeFileSync(path.join(rt, "traces", "req001.json"), JSON.stringify({ request_id: "req001", started_at: "x", steps: [], total_ms: 0, total_cost_usd: 0 }));
  fs.writeFileSync(path.join(tmp, "inbox.json"), "[]");
  fs.writeFileSync(path.join(tmp, "usage.json"), JSON.stringify([{ cost_usd: 0.1 }]));
  const env = { DATA_RUNTIME_DIR: rt, INBOX_FILE: path.join(tmp, "inbox.json"), USAGE_FILE: path.join(tmp, "usage.json"), SESSIONS_DIR: sessions };
  const r1 = run("save_session.ts", [], env);
  const made = fs.existsSync(sessions) ? fs.readdirSync(sessions) : [];
  const d1 = made.length ? path.join(sessions, made[0]) : "";
  check("発表用：data/sessions/<日時>/ に写す", r1.status === 0 && made.length === 1 && /^\d{8}-\d{6}$/.test(made[0]), `${r1.stdout}${r1.stderr}`.slice(0, 300));
  check("写すもの：feedback.jsonl・traces/・inbox.json・usage.json", ["feedback.jsonl", "traces/req001.json", "inbox.json", "usage.json"].every((f) => fs.existsSync(path.join(d1, f))));
  check("元の記録は消さない（写すだけ）", fs.existsSync(path.join(rt, "feedback.jsonl")) && fs.existsSync(path.join(rt, "traces", "req001.json")));
  check("出力に、写したものから評価のケースを作る方法が出る", /eval:from-feedback -- /.test(r1.stdout));
  const e1 = run("eval_from_feedback.ts", [d1], { ...env, DATA_RUNTIME_DIR: path.join(tmp, "elsewhere") });
  const out1 = path.join(d1, "eval_candidates");
  const files1 = fs.existsSync(out1) ? fs.readdirSync(out1) : [];
  check("写したものから eval:from-feedback を流せる（場所を引数で渡す）", e1.status === 0 && files1.length === 1, `${e1.stdout}${e1.stderr}`.slice(0, 300));
  check("出したケースに、メールが残らない", files1.every((f) => !fs.readFileSync(path.join(out1, f), "utf-8").includes("taro@example.com")));

  // ---- 見せる用：visitors/ ごと
  const shareDir = path.join(tmp, "runtime-share");
  const A = "a".repeat(32);
  const B = "b".repeat(32);
  for (const [k, target] of [[A, "e001"], [B, "e002"]] as const) {
    fs.mkdirSync(path.join(shareDir, "visitors", k, "traces"), { recursive: true });
    fs.writeFileSync(path.join(shareDir, "visitors", k, "feedback.jsonl"), fbRow(`fb-${k[0]}`, "req001", target));
    fs.writeFileSync(path.join(shareDir, "visitors", k, "inbox.json"), "[]");
  }
  fs.writeFileSync(path.join(shareDir, "usage.json"), JSON.stringify([{ cost_usd: 0.2 }]));
  const r2 = run("save_session.ts", ["--share"], { SHARE_DATA_DIR: shareDir, SESSIONS_DIR: sessions });
  const d2 = fs.readdirSync(sessions).map((n) => path.join(sessions, n)).find((p) => p !== d1) ?? "";
  check("見せる用：visitors/（人ごとの場所）をまとめて写す", r2.status === 0 && [A, B].every((k) => fs.existsSync(path.join(d2, "visitors", k, "feedback.jsonl"))) && fs.existsSync(path.join(d2, "usage.json")), `${r2.stdout}${r2.stderr}`.slice(0, 300));
  const e2 = run("eval_from_feedback.ts", [d2], {});
  const out2 = path.join(d2, "eval_candidates");
  const files2 = fs.existsSync(out2) ? fs.readdirSync(out2).sort() : [];
  check("見せる用の記録からも、人ごとに読んでケースの候補を出す（同じ依頼でも重ならない）", e2.status === 0 && files2.length === 2 && files2[0] !== files2[1] && files2.every((f) => f.startsWith("usage-")), `${files2.join(",")} ${e2.stdout.split("\n")[0]}`);

  // ---- 写すものがないとき・ない場所
  const r3 = run("save_session.ts", ["--share"], { SHARE_DATA_DIR: path.join(tmp, "none"), SESSIONS_DIR: path.join(tmp, "sessions-empty") });
  check("写すものがなければ、何も作らない", r3.status === 0 && !fs.existsSync(path.join(tmp, "sessions-empty")) && /写すものがありませんでした/.test(r3.stdout));
  const e3 = run("eval_from_feedback.ts", [path.join(tmp, "no-such")], {});
  check("ない場所を渡したら、理由を出して止まる", e3.status === 1 && /その場所がありません/.test(e3.stderr));

  // ---- git の対象外・reset:demo の一文
  const ig = spawnSync("git", ["check-ignore", "-q", "data/sessions/20261122-101530/feedback.jsonl"]);
  check("data/sessions/ は git の対象外", ig.status === 0);
  const rd = run("reset_demo.ts", [], { DATA_RUNTIME_DIR: path.join(tmp, "reset-rt") });
  check("reset:demo の出力に「戻す前に save:session」の一文が出る", /戻す前に npm run save:session/.test(rd.stdout), rd.stdout.slice(0, 200));
  const cl = fs.readFileSync(path.join("docs", "demo_checklist.md"), "utf-8");
  check("docs/demo_checklist.md に「戻す前に save:session」がある", /戻す前に save:session/.test(cl));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
process.exit(failed ? 1 : 0);
