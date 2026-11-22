// メンターの印（role: "mentor"）を、使われた結果と実行の記録の各ステップに付けるテスト（API は使わない・data/ に書き込まない）。
//   npx tsx scripts/test_mentor_role.ts（npm test にも入る）
// 見るもの：メンターの窓口の中（①の perPerson・currentRole）で記録したステップに role が付く／一般の人・発表用では付かない／
//           POST /api/feedback は cookie（roleOf）で決め、本文の role は使わない／eval:from-feedback --role mentor で選べる
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mentor-role-"));
const SHARE: Record<string, string> = {
  SHARE_MODE: "lan",
  ACCESS_CODE: "test-access-code-123456",
  MENTOR_ACCESS_CODE: "test-mentor-code-123456",
  SHARE_BUDGET_USD: "5",
  DATA_RUNTIME_DIR: path.join(tmp, "share"),
};

async function main() {
  const trace = await import("../lib/trace");
  const pb = await import("../lib/personBudget");
  const share = await import("../lib/share");
  const vs = await import("../lib/visitorScope");
  const { visitorKey, VISITOR_COOKIE } = await import("../lib/visitor");
  const fbm = await import("../lib/feedback");
  const route = await import("../app/api/feedback/route");
  const stepsOf = (id: string) => trace.getTrace(id)?.steps ?? [];

  // ---- 発表用：付かない
  process.env.DATA_RUNTIME_DIR = path.join(tmp, "local");
  // 発表用では①の perPerson が人の中に入らない（currentRole は null）ので、窓口を通ったときと同じく、人の外で記録する
  await trace.withTrace("req001", () => trace.traceCode("発表用", () => 1));
  check("発表用：role は付かない", stepsOf("req001").length === 1 && stepsOf("req001")[0].role === undefined);

  // ---- 見せる用
  Object.assign(process.env, SHARE);
  const mentorId = "mentor-person-id";
  const generalId = "general-person-id";
  const M = visitorKey(mentorId);
  const G = visitorKey(generalId);
  await vs.withVisitor(M, () => pb.runAsPerson(M, () => trace.withTrace("req001", () => trace.traceCode("メンターの操作", () => 1)), "mentor"));
  await vs.withVisitor(G, () => pb.runAsPerson(G, () => trace.withTrace("req001", () => trace.traceCode("一般の操作", () => 1)), "general"));
  await vs.withVisitor(G, () => trace.withTrace("req002", () => trace.traceCode("窓口の外", () => 1)));
  const ms = vs.withVisitor(M, () => stepsOf("req001"));
  const gs = vs.withVisitor(G, () => stepsOf("req001"));
  check("メンターの窓口の中で記録したステップに role: \"mentor\" が付く", ms.length === 1 && ms[0].role === "mentor", JSON.stringify(ms));
  check("一般の人のステップには付かない", gs.length === 1 && gs[0].role === undefined, JSON.stringify(gs));
  check("窓口の外（currentRole が null）では付かない", vs.withVisitor(G, () => stepsOf("req002")).every((s) => s.role === undefined));
  // 同じ依頼の記録に、メンターと一般の操作が混ざっても、ステップごとに分かる
  await vs.withVisitor(M, () => pb.runAsPerson(M, () => trace.withTrace("req003", () => trace.traceCode("メンター", () => 1)), "mentor"));
  await vs.withVisitor(M, () => pb.runAsPerson(M, () => trace.withTrace("req003", () => trace.traceCode("一般", () => 1)), "general"));
  check("同じ依頼の記録でも、ステップごとに付く", JSON.stringify(vs.withVisitor(M, () => stepsOf("req003")).map((s) => s.role ?? "-")) === '["mentor","-"]');
  // 裏で続く処理（窓口が返したあと）も、始めた人の役割のまま
  let later: Promise<unknown> | null = null;
  vs.withVisitor(M, () =>
    pb.runAsPerson(M, () => {
      later = trace.withTrace("req004", async () => {
        await new Promise((r) => setTimeout(r, 20));
        await trace.traceCode("裏の処理", () => 1);
      });
    }, "mentor"),
  );
  await later;
  check("裏で続く処理のステップにも付く", vs.withVisitor(M, () => stepsOf("req004"))[0]?.role === "mentor");

  // ---- 使われた結果：窓口は cookie で決める
  const mentorCookie = `nb_access=${share.accessToken()}; ${VISITOR_COOKIE}=${mentorId}; ${share.MENTOR_COOKIE}=${share.mentorToken()}`;
  const generalCookie = `nb_access=${share.accessToken()}; ${VISITOR_COOKIE}=${generalId}`;
  const post = (cookie: string, extra: object = {}) =>
    route.POST(
      new Request("http://127.0.0.1:3100/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ request_id: "req001", target: "candidate", target_id: "e001", verdict: "good", ...extra }),
      }),
    );
  const r1 = await vs.withVisitor(M, () => post(mentorCookie));
  const r2 = await vs.withVisitor(G, () => post(generalCookie, { role: "mentor" }));
  const r3 = await vs.withVisitor(G, () => post(`${generalCookie}; ${share.MENTOR_COOKIE}=mentor`));
  const mRows = vs.withVisitor(M, () => fbm.readFeedback());
  const gRows = vs.withVisitor(G, () => fbm.readFeedback());
  check("メンターの印（cookie nb_role）がある人の使われた結果に role: \"mentor\" が付く", r1.status === 200 && mRows.length === 1 && mRows[0].role === "mentor", JSON.stringify(mRows));
  check("本文で role: \"mentor\" を送っても、一般の人には付かない", r2.status === 200 && gRows[0]?.role === undefined);
  check("偽の印（ハッシュが違う）では付かない", r3.status === 200 && gRows.length === 2 && gRows.every((r) => r.role === undefined));
  // 発表用の窓口
  for (const k of Object.keys(SHARE)) delete process.env[k];
  process.env.DATA_RUNTIME_DIR = path.join(tmp, "local2");
  const r4 = await post(mentorCookie);
  check("発表用では付かない（メンターの印があっても）", r4.status === 200 && fbm.readFeedback().every((r) => r.role === undefined));

  // ---- eval:from-feedback --role mentor
  const dir = path.join(tmp, "session");
  fs.mkdirSync(dir, { recursive: true });
  const line = (o: object) => JSON.stringify(o) + "\n";
  fs.writeFileSync(
    path.join(dir, "feedback.jsonl"),
    line({ id: "fb-m", at: "2026-11-22T10:00:00+09:00", request_id: "req001", target: "candidate", target_id: "e001", verdict: "good", reason_code: "good", role: "mentor" }) +
      line({ id: "fb-g", at: "2026-11-22T10:01:00+09:00", request_id: "req002", target: "candidate", target_id: "e002", verdict: "good", reason_code: "good" }),
  );
  fs.writeFileSync(path.join(dir, "inbox.json"), "[]");
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const run = (...args: string[]) => {
    const out = path.join(dir, "eval_candidates");
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(process.execPath, [tsx, path.join("scripts", "eval_from_feedback.ts"), ...args], { env: { ...process.env }, encoding: "utf-8" });
    return { r, files: fs.existsSync(out) ? fs.readdirSync(out).sort() : [] };
  };
  const all = run(dir);
  check("指定なし：全部", all.r.status === 0 && all.files.length === 2, all.files.join(","));
  const m = run(dir, "--role", "mentor");
  check("--role mentor：メンターの記録だけ", m.r.status === 0 && m.files.length === 1 && m.files[0] === "usage-req001.json" && /メンターの記録だけ/.test(m.r.stdout), `${m.files.join(",")} ${m.r.stderr.slice(0, 200)}`);
  const m2 = run("--role=mentor", dir);
  check("--role=mentor の形・場所の前に書いても同じ", m2.r.status === 0 && JSON.stringify(m2.files) === JSON.stringify(m.files));
  const g = run(dir, "--role", "general");
  check("--role general：メンター以外だけ", g.r.status === 0 && g.files.length === 1 && g.files[0] === "usage-req002.json", g.files.join(","));
  const bad = run(dir, "--role", "admin");
  check("ほかの値は理由を出して止まる", bad.r.status === 1 && /--role は mentor か general/.test(bad.r.stderr));
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
    process.exit(failed ? 1 : 0);
  });
