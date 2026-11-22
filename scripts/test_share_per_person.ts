// 見せる用の1人あたりの API 代の上限（SHARE_PER_PERSON_USD）と、見せる用でできることのテスト（API は使わない）。
//   npm run test:per-person
import "./_isolate";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf-8");
const CODE = "test-code-for-per-person";
const setLan = (perPerson: string | null) => {
  process.env.SHARE_MODE = "lan";
  process.env.ACCESS_CODE = CODE;
  process.env.SHARE_BUDGET_USD = "50";
  if (perPerson === null) delete process.env.SHARE_PER_PERSON_USD;
  else process.env.SHARE_PER_PERSON_USD = perPerson;
};
const clearLan = () => ["SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD", "SHARE_PER_PERSON_USD"].forEach((k) => delete process.env[k]);

async function main() {
  const pb = await import("../lib/personBudget");
  const { recordUsage, chooseModels } = await import("../lib/usage");
  const model = chooseModels().loop;
  // 1回あたり約 $1 になる使い方（モデルの値段から逆算しない：記録された金額で数える）
  const spend = (runId: string) => recordUsage(runId, "loop", model, { input_tokens: 200_000, output_tokens: 20_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

  // ---- 発表用には効かない ----
  clearLan();
  check("発表用：1人あたりの上限はない", pb.perPersonUsd() === null);
  pb.runAsPerson(pb.personKey("someone"), () => spend("present-1"));
  check("発表用：人ごとの記録はつけない", !fs.existsSync(pb.personUsageFile()));

  // ---- 見せる用：人ごとに数える ----
  setLan("5");
  check("見せる用：SHARE_PER_PERSON_USD=5 が上限", pb.perPersonUsd() === 5);
  const alice = "alice-random-cookie-value";
  const kA = pb.personKey(alice);
  const kB = pb.personKey("bob-random-cookie-value");
  check("人の名前は印のハッシュ（印の値そのものではない）", kA !== alice && kA.length === 32 && !kA.includes("alice"));
  const e1 = pb.runAsPerson(kA, () => spend("share-a-1"));
  const ledgerText = fs.readFileSync(pb.personUsageFile(), "utf-8");
  check("使った金額を、その人に足す（data/runtime-share/ にあたる置き場の person_usage.json）", Math.abs(pb.personSpent(kA) - e1.cost_usd) < 1e-6 && path.dirname(pb.personUsageFile()) === path.resolve(process.env.DATA_RUNTIME_DIR!), `$${pb.personSpent(kA).toFixed(3)}`);
  check("記録に印の値そのものは入れない", !ledgerText.includes(alice));
  check("ほかの人には足さない", pb.personSpent(kB) === 0);
  spend("share-no-person");
  check("人の中でない記録（評価スクリプトなど）は、だれにも足さない", pb.personSpent(kA) === e1.cost_usd && pb.personSpent(pb.NO_PERSON) === 0);

  // 裏で続く処理（受信箱の候補づくりなど）も、その人に足す
  const wrapped = pb.perPerson(async (_req: Request) => {
    setTimeout(() => spend("share-a-bg"), 10);
    return new Response("ok");
  });
  await wrapped(new Request("http://192.168.1.20:3100/api/inbox", { method: "POST", headers: { cookie: `nb_access=x; ${pb.PERSON_COOKIE}=${alice}` } }));
  await new Promise((r) => setTimeout(r, 50));
  check("窓口を返したあと裏で続く処理の金額も、その人に足す", pb.personSpent(kA) > e1.cost_usd * 1.9, `$${pb.personSpent(kA).toFixed(3)}`);

  // 上限まで使う
  while (pb.personSpent(kA) < 5) pb.runAsPerson(kA, () => spend("share-a-more"));
  const over = pb.checkPerson(kA);
  check("上限を超えたら、その人だけ止める（429・決まった文）", !over.ok && over.status === 429 && over.error === "この端末で試せる分を使い切りました。保存済みの例（?mock）は引き続き見られます", over.ok ? "" : over.error);
  check("ほかの人は止めない", pb.checkPerson(kB).ok);
  check("残りは 0 より下にしない", pb.personRemaining(kA) === 0 && pb.personRemaining(kB) === 5);

  // ---- 入口（proxy.ts） ----
  const { proxy } = await import("../proxy");
  const { NextRequest } = await import("next/server");
  const share = await import("../lib/share");
  const H = (cookie: string) => ({ host: "192.168.1.20:3100", origin: "http://192.168.1.20:3100", cookie });
  const authed = `nb_access=${share.accessToken()}`;
  const post = (p: string, cookie: string) => proxy(new NextRequest(`http://192.168.1.20:3100${p}`, { method: "POST", headers: H(cookie) }));
  const rA = post("/api/agent", `${authed}; ${pb.PERSON_COOKIE}=${alice}`);
  const rAj = (await rA.json()) as { error?: string };
  check("入口：使い切った人の API を使う操作は 429 と決まった文", rA.status === 429 && rAj.error === pb.PERSON_LIMIT_MESSAGE);
  const rAget = proxy(new NextRequest("http://192.168.1.20:3100/api/cards", { headers: H(`${authed}; ${pb.PERSON_COOKIE}=${alice}`) }));
  check("入口：使い切った人も、見るだけの操作は続けられる", rAget.headers.get("x-middleware-next") === "1");
  const rB = post("/api/notebook", `${authed}; ${pb.PERSON_COOKIE}=bob-random-cookie-value`);
  check("入口：ほかの人は API を使う操作（ネタ帳を更新も）を続けられる", rB.headers.get("x-middleware-next") === "1", `${rB.status}`);
  const rNew = proxy(new NextRequest("http://192.168.1.20:3100/", { headers: H(authed) }));
  const setCookie = rNew.headers.get("set-cookie") ?? "";
  check("入口：合言葉で入っていて人の印がなければ、ここで付ける（httpOnly）", setCookie.includes(`${pb.PERSON_COOKIE}=`) && /HttpOnly/.test(setCookie));
  process.env.SHARE_PER_PERSON_USD = "";
  const rNoLimit = post("/api/agent", `${authed}; ${pb.PERSON_COOKIE}=${alice}`);
  check("入口：SHARE_PER_PERSON_USD がなければ、人ごとには止めない", rNoLimit.headers.get("x-middleware-next") === "1");
  process.env.SHARE_PER_PERSON_USD = "5";
  // 合計の上限はそのまま（印を消して数え直しても、合計で止まる）
  process.env.SHARE_BUDGET_USD = "0.01";
  spend("share-after-start"); // 見せ始めた（入口を読んだ）あとの記録で、合計を超えさせる
  const rFresh = post("/api/agent", `${authed}; ${pb.PERSON_COOKIE}=brand-new-person`);
  check("入口：合計の上限（SHARE_BUDGET_USD）はそのまま効く（新しい人でも止まる）", rFresh.status === 429 && ((await rFresh.json()) as { error: string }).error.includes("上限"));
  process.env.SHARE_BUDGET_USD = "50";

  // ---- 合言葉の窓口：人の印を付ける ----
  const { POST: access } = await import("../app/api/access/route");
  const ok = await access(new Request("http://192.168.1.20:3100/api/access", { method: "POST", headers: { "x-forwarded-for": "192.168.1.30" }, body: JSON.stringify({ code: CODE }) }));
  const sc = ok.headers.get("set-cookie") ?? "";
  check("合言葉が合ったら、人の印も付ける", ok.status === 200 && sc.includes(`${pb.PERSON_COOKIE}=`));
  const again = await access(new Request("http://192.168.1.20:3100/api/access", { method: "POST", headers: { "x-forwarded-for": "192.168.1.30", cookie: `${pb.PERSON_COOKIE}=${alice}` }, body: JSON.stringify({ code: CODE }) }));
  check("もう人の印があれば変えない（入り直しで数え直さない）", !(again.headers.get("set-cookie") ?? "").includes(`${pb.PERSON_COOKIE}=`));

  // ---- /api/state：見せる用のときだけ、残りと「同じ受信箱」 ----
  const { GET: state } = await import("../app/api/state/route");
  const stB = (await (await state(new Request("http://192.168.1.20:3100/api/state", { headers: H(`${authed}; ${pb.PERSON_COOKIE}=bob-random-cookie-value`) }))).json()) as { share: { person_remaining_usd: number | null } | null };
  check("見せる用：/api/state にその人の残り（$5）", stB.share?.person_remaining_usd === 5);
  clearLan();
  const stP = (await (await state(new Request("http://127.0.0.1:3000/api/state", { headers: { host: "127.0.0.1:3000" } }))).json()) as { share: unknown };
  check("発表用：/api/state に見せる用の表示はない", stP.share === null);

  // ---- 画面 ----
  const header = read("components/Header.tsx");
  check("画面：見せる用のときだけ、上のほうにその人の残りを小さく出す（「同じ受信箱」は出さない）", header.includes("`あと ${usdText(share.person_remaining_usd)} 分試せます`") && header.includes("{share && share.person_remaining_usd !== null && (") && !header.includes("同じ受信箱"));
  check("人の見分け方は1つの関数（visitorKeyOf）にまとめる（③の lib/visitor.ts が入ったら差し替える）", read("lib/personBudget.ts").includes("export function visitorKeyOf(req: Request): string") && read("app/api/state/route.ts").includes("visitorKeyOf(req)"));

  // ---- API を使う窓口は、すべて人ごとに数える ----
  const routes = ["app/api/agent/route.ts", "app/api/draft/route.ts", "app/api/blog-ideas/route.ts", "app/api/inbox/route.ts", "app/api/inbox/[id]/proceed/route.ts", "app/api/events/[id]/analyze/route.ts", "app/api/events/[id]/import/route.ts", "app/api/venues/route.ts", "app/api/venues/draft/route.ts", "app/api/notebook/route.ts"];
  const missing = routes.filter((f) => !/export const POST = perPerson\(/.test(read(f)));
  check("API を使う窓口は、すべて perPerson で包む", !missing.length, missing.join(", "));
  check("「依頼として進める」も API を使う操作として、上限の対象", share.spendsApi("POST", "/api/inbox/inb-abc/proceed"));

  // ---- 見せる用でできること ----
  check("見せる用で止める操作はない（ネタ帳を更新も使える）", share.LAN_BLOCKED.length === 0);
  setLan("5");
  const dbg = proxy(new NextRequest("http://192.168.1.20:3100/?debug", { headers: H(`${authed}; ${pb.PERSON_COOKIE}=x`) }));
  check("?debug は見せる用では今までどおり外す", dbg.status === 307 && !(dbg.headers.get("location") ?? "").includes("debug"));
  clearLan();

  // ---- 設定 ----
  const tmp = fs.mkdtempSync(path.join(path.dirname(process.env.DATA_RUNTIME_DIR!), "serve-pp-"));
  const cfg = (v: string) =>
    spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "serve.mjs"), "start", "--share", "--print-config"], {
      cwd: tmp,
      encoding: "utf-8",
      env: { ...process.env, SHARE_MODE: "", ACCESS_CODE: CODE, SHARE_BUDGET_USD: "5", SHARE_PER_PERSON_USD: v },
      timeout: 30000,
    });
  check("SHARE_PER_PERSON_USD が数でなければ、見せる用は起動しない", cfg("abc").status === 1 && cfg("abc").stderr.includes("SHARE_PER_PERSON_USD"));
  check("SHARE_PER_PERSON_USD=5 なら起動できる・空でも起動できる（人ごとには止めない）", cfg("5").status === 0 && cfg("").status === 0);
  fs.rmSync(tmp, { recursive: true, force: true });
  check(".env.example と docs/demo_checklist.md に SHARE_PER_PERSON_USD", read(".env.example").includes("SHARE_PER_PERSON_USD") && read("docs/demo_checklist.md").includes("SHARE_PER_PERSON_USD"));

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
