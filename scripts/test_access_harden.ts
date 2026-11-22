// 合言葉の守りのテスト（API は使わない）。npm run test:access
//   - 見せる用の合言葉は12文字以上（短ければ起動しない）
//   - 送り元に関係なく、5分で間違いが合計30回を超えたら1分はだれの合言葉も受け付けない（印〔cookie〕のある人は止めない）
//   - 見せる用の起動（scripts/serve.mjs）は、送り元（x-forwarded-for）を接続そのものの値に置き換える
import "./_isolate";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

const CODE = "test-code-for-share";

async function main() {
  // ---- 合言葉の長さ ----
  const share = await import("../lib/share");
  process.env.SHARE_MODE = "lan";
  process.env.SHARE_BUDGET_USD = "5";
  process.env.ACCESS_CODE = "a".repeat(11);
  const p11 = share.shareConfigProblem();
  check("lan で合言葉が11文字なら、起動を止める理由がある（12文字以上）", !!p11?.includes("12文字以上") && !p11.includes("a".repeat(11)), p11 ?? "");
  process.env.ACCESS_CODE = "あいうえおかきくけこさし"; // 12文字（日本語も文字数で数える）
  check("12文字なら起動できる（日本語は文字数で数える）", share.shareConfigProblem() === null);
  process.env.ACCESS_CODE = CODE;

  const serve = path.join(process.cwd(), "scripts", "serve.mjs");
  const tmp = fs.mkdtempSync(path.join(path.dirname(process.env.DATA_RUNTIME_DIR!), "serve-access-"));
  const cfg = (code: string) =>
    spawnSync(process.execPath, [serve, "start", "--share", "--print-config"], {
      cwd: tmp, // .env のない場所で動かす
      encoding: "utf-8",
      env: { ...process.env, SHARE_MODE: "", ACCESS_CODE: code, SHARE_BUDGET_USD: "5" },
      timeout: 30000,
    });
  const short = cfg("short-code1");
  check("見せる用の起動：合言葉が12文字未満なら起動しない（理由を出し、合言葉は出さない）", short.status === 1 && short.stderr.includes("12文字以上") && !short.stderr.includes("short-code1"), short.stderr.trim());
  const long = cfg(CODE);
  check("見せる用の起動：12文字以上なら起動できる（合言葉は出さない）", long.status === 0 && !long.stdout.includes(CODE), `${long.status}`);
  fs.rmSync(tmp, { recursive: true, force: true });

  const doc = fs.readFileSync(path.join(process.cwd(), "docs", "demo_checklist.md"), "utf-8");
  const ex = doc.match(/ACCESS_CODE=（12文字以上の合言葉。例：([^）]+)）/)?.[1] ?? "";
  check("docs/demo_checklist.md の合言葉の例は12文字以上", [...ex].length >= 12, ex);

  // ---- 全体の上限 ----
  const guard = await import("../lib/accessGuard");
  guard.clearAccessGuard();
  const t0 = Date.now();
  let lock = null as ReturnType<typeof guard.noteAccessFailure>;
  // 送り元を変えながら（1つの送り元は4回まで）30回間違える
  for (let i = 0; i < 30; i++) lock = guard.noteAccessFailure(`10.0.${Math.floor(i / 4)}.1`, t0 + i * 100);
  check("送り元を変えながら30回間違えても、まだ止めない（30回を超えたら）", lock === null);
  lock = guard.noteAccessFailure("10.9.9.9", t0 + 3100);
  check("31回目で、全体を止める", lock?.scope === "all", lock?.message ?? "");
  check("止めている間は、ほかの送り元も受け付けない", guard.accessLock("192.168.1.200", t0 + 3200)?.scope === "all");
  check("全体の止めは1分", guard.accessLock("192.168.1.200", t0 + 3100 + 59_000) !== null && guard.accessLock("192.168.1.200", t0 + 3100 + 60_500) === null);
  check("止めの文は、待つ時間を出す（合言葉は出さない）", /1分ほど待って/.test(lock?.message ?? "") && !(lock?.message ?? "").includes(CODE));

  guard.clearAccessGuard();
  const t1 = Date.now();
  for (let i = 0; i < 30; i++) guard.noteAccessFailure(`10.1.${i}.1`, t1 - guard.ACCESS_GLOBAL_WINDOW_MS - 1000); // 5分より前
  check("5分より前の間違いは、全体の数に入れない", guard.noteAccessFailure("10.2.0.1", t1) === null);

  // 窓口と入口で通しに
  guard.clearAccessGuard();
  const { POST: access } = await import("../app/api/access/route");
  const post = (code: string, ip: string) =>
    access(new Request("http://192.168.1.20:3100/api/access", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ code }) }));
  const ok = await post(CODE, "192.168.1.10");
  const cookie = (ok.headers.get("set-cookie") ?? "").split(";")[0];
  const sts: number[] = [];
  for (let i = 0; i < 31; i++) sts.push((await post("wrong", `172.16.${Math.floor(i / 4)}.${i % 4}`)).status);
  check("窓口：送り元を変えて31回間違えると、31回目で 429", sts.slice(0, 30).every((s) => s === 401) && sts[30] === 429, `${sts.filter((s) => s === 401).length}回 401 → ${sts[30]}`);
  const right = await post(CODE, "192.168.1.11");
  const rj = (await right.json()) as { error?: string };
  check("窓口：止めている間は、正しい合言葉でも受け付けない（印も付けない）", right.status === 429 && !right.headers.get("set-cookie") && !!rj.error?.includes("間違いが続いている"), rj.error);

  const { proxy } = await import("../proxy");
  const { NextRequest } = await import("next/server");
  const withCookie = proxy(new NextRequest("http://192.168.1.20:3100/api/cards", { headers: { host: "192.168.1.20:3100", cookie, "x-forwarded-for": "192.168.1.10" } }));
  check("入口：印（cookie）がある人は、止めている間も通す", !!cookie && withCookie.headers.get("x-middleware-next") === "1", `${withCookie.status}`);
  const withHeader = proxy(new NextRequest("http://192.168.1.20:3100/api/cards", { headers: { host: "192.168.1.20:3100", "x-access-code": CODE, "x-forwarded-for": "192.168.1.12" } }));
  check("入口：ヘッダーの合言葉は、止めている間は受け付けない", withHeader.status === 429);
  guard.clearAccessGuard();

  // ---- 見せる用の起動は、送り元を接続から取る ----
  const src = fs.readFileSync(serve, "utf-8");
  check(
    "見せる用の起動：送ってきた x-forwarded-for などを捨てて、接続そのものの値に置き換える",
    /delete req\.headers\[h\]/.test(src) && src.includes('req.headers["x-forwarded-for"] = req.socket.remoteAddress') && src.includes('"x-real-ip", "forwarded"'),
  );
  check("発表用（npm start）の起動のしかたは今までどおり（next start を子プロセスで）", /function startNext\(\)/.test(src) && src.includes("spawn(process.execPath, [next, mode"));

  delete process.env.SHARE_MODE;
  delete process.env.SHARE_BUDGET_USD;
  delete process.env.ACCESS_CODE;
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
