// 見せる用の側ごとの合計の上限（一般側 SHARE_GENERAL_POOL_USD・メンター側 SHARE_MENTOR_POOL_USD）のテスト（API は使わない）。
//   npm run test:pools
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
const CODE = "pools-general-code-test";
const MENTOR = "pools-mentor-code-test";

async function main() {
  const pb = await import("../lib/personBudget");
  const share = await import("../lib/share");

  // ---- 発表用には効かない ----
  process.env.SHARE_GENERAL_POOL_USD = "1";
  check("発表用：側ごとの上限はない", pb.poolUsd("general") === null && pb.checkPool("general").ok);

  process.env.SHARE_MODE = "lan";
  process.env.ACCESS_CODE = CODE;
  process.env.MENTOR_ACCESS_CODE = MENTOR;
  process.env.SHARE_BUDGET_USD = "100";
  process.env.SHARE_PER_PERSON_USD = "50";
  process.env.SHARE_MENTOR_USD = "50";
  process.env.SHARE_GENERAL_POOL_USD = "3";
  process.env.SHARE_MENTOR_POOL_USD = "4";
  check("設定：一般側 $3・メンター側 $4", pb.poolUsd("general") === 3 && pb.poolUsd("mentor") === 4);
  check("設定がそろえば起動できる", share.shareConfigProblem() === null);
  process.env.SHARE_MENTOR_POOL_USD = "abc";
  check("数でなければ、起動を止める理由がある", !!share.shareConfigProblem()?.includes("SHARE_MENTOR_POOL_USD"));
  process.env.SHARE_MENTOR_POOL_USD = "4";

  // ---- 側ごとに数える ----
  const { recordUsage, chooseModels } = await import("../lib/usage");
  const model = chooseModels().loop;
  const spend = (id: string) => recordUsage(id, "loop", model, { input_tokens: 200_000, output_tokens: 20_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const g1 = pb.personKey("general-1");
  const g2 = pb.personKey("general-2");
  const m1 = pb.personKey("mentor-1");
  pb.runAsPerson(g1, () => spend("g1"), "general");
  pb.runAsPerson(m1, () => spend("m1"), "mentor");
  const one = pb.personSpent(g1);
  check("一般の人の分は一般側、メンターの分はメンター側に数える", Math.abs(pb.poolSpent("general") - one) < 1e-6 && Math.abs(pb.poolSpent("mentor") - pb.personSpent(m1)) < 1e-6, `一般 $${pb.poolSpent("general").toFixed(2)}・メンター $${pb.poolSpent("mentor").toFixed(2)}`);
  check("人ごとの記録には、メンターとして使った分（mentor_usd）も残す", (JSON.parse(fs.readFileSync(pb.personUsageFile(), "utf-8")) as Record<string, { mentor_usd?: number }>)[m1]?.mentor_usd === pb.personSpent(m1));

  // 一般側を使い切る（2人で分けて使っても、側の合計で止まる）
  while (pb.poolSpent("general") < 3) pb.runAsPerson(pb.poolSpent("general") < 1.5 ? g1 : g2, () => spend("g"), "general");
  const gStop = pb.checkPool("general");
  check("一般側の合計が上限に届いたら、一般の人は止まる（429・理由つき）", !gStop.ok && gStop.status === 429 && gStop.error.includes("一般の参加者の分"), gStop.ok ? "" : gStop.error.slice(0, 30));
  check("一般側が届いても、メンター側は続けられる", pb.checkPool("mentor").ok);

  // ---- 入口（proxy.ts） ----
  const { proxy } = await import("../proxy");
  const { NextRequest } = await import("next/server");
  const authed = `nb_access=${share.accessToken()}`;
  const post = (cookie: string, p = "/api/agent") =>
    proxy(new NextRequest(`http://192.168.1.20:3100${p}`, { method: "POST", headers: { host: "192.168.1.20:3100", origin: "http://192.168.1.20:3100", cookie } }));
  const newGeneral = post(`${authed}; ${pb.PERSON_COOKIE}=general-new`);
  check("入口：一般側が届いたら、まだ使っていない一般の人も止まる", newGeneral.status === 429 && ((await newGeneral.json()) as { error: string }).error.includes("一般の参加者の分"));
  const mentorCookie = `${authed}; ${pb.PERSON_COOKIE}=mentor-1; ${share.MENTOR_COOKIE}=${share.mentorToken()}`;
  check("入口：メンター・審査員は続けられる", post(mentorCookie).headers.get("x-middleware-next") === "1");
  const viewG = proxy(new NextRequest("http://192.168.1.20:3100/api/cards", { headers: { host: "192.168.1.20:3100", cookie: `${authed}; ${pb.PERSON_COOKIE}=general-new` } }));
  check("入口：止まった側も、見るだけの操作は続けられる", viewG.headers.get("x-middleware-next") === "1");

  const { GET: state } = await import("../app/api/state/route");
  const st = (await (await state(new Request("http://192.168.1.20:3100/api/state", { headers: { host: "192.168.1.20:3100", cookie: `${authed}; ${pb.PERSON_COOKIE}=general-new` } }))).json()) as { share: { person_remaining_usd: number } };
  check("画面の残り：その側が使い切ったら、その人の残りがあっても 0（使い切りの表示）", st.share.person_remaining_usd === 0);

  // メンター側を使い切る
  while (pb.poolSpent("mentor") < 4) pb.runAsPerson(m1, () => spend("m"), "mentor");
  const mStop = post(mentorCookie);
  check("入口：メンター側が届いたら、メンター・審査員も止まる（理由はメンター側）", mStop.status === 429 && ((await mStop.json()) as { error: string }).error.includes("メンター・審査員の分"));

  // 空なら付けない・合計の上限は別に効く
  process.env.SHARE_GENERAL_POOL_USD = "";
  process.env.SHARE_MENTOR_POOL_USD = "";
  check("側ごとの上限が空なら、その側には付けない", pb.poolUsd("general") === null && post(`${authed}; ${pb.PERSON_COOKIE}=general-new`).headers.get("x-middleware-next") === "1");
  process.env.SHARE_BUDGET_USD = "0.01";
  spend("after-start"); // 見せ始めたあとの記録で、合計を超えさせる
  check("合計の上限（SHARE_BUDGET_USD）はそのまま効く", post(mentorCookie).status === 429);
  process.env.SHARE_BUDGET_USD = "100";

  // ---- 起動・文書 ----
  const tmp = fs.mkdtempSync(path.join(path.dirname(process.env.DATA_RUNTIME_DIR!), "serve-pools-"));
  const cfg = (env: Record<string, string>) =>
    spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "serve.mjs"), "start", "--share", "--print-config"], {
      cwd: tmp,
      encoding: "utf-8",
      env: { ...process.env, SHARE_MODE: "", ACCESS_CODE: CODE, MENTOR_ACCESS_CODE: MENTOR, SHARE_BUDGET_USD: "50", ...env },
      timeout: 30000,
    });
  check("見せる用の起動：側ごとの上限が数でなければ起動しない", cfg({ SHARE_GENERAL_POOL_USD: "x" }).status === 1);
  const okCfg = cfg({ SHARE_GENERAL_POOL_USD: "20", SHARE_MENTOR_POOL_USD: "30" });
  check("見せる用の起動：20・30 なら起動でき、設定の確認に出る（合言葉は出さない）", okCfg.status === 0 && okCfg.stdout.includes('"SHARE_GENERAL_POOL_USD":"20"') && !okCfg.stdout.includes(CODE) && !okCfg.stdout.includes(MENTOR));
  fs.rmSync(tmp, { recursive: true, force: true });
  check(".env.example と docs/demo_checklist.md に SHARE_GENERAL_POOL_USD・SHARE_MENTOR_POOL_USD", ["SHARE_GENERAL_POOL_USD", "SHARE_MENTOR_POOL_USD"].every((k) => read(".env.example").includes(k) && read("docs/demo_checklist.md").includes(k)));

  ["SHARE_MODE", "ACCESS_CODE", "MENTOR_ACCESS_CODE", "SHARE_BUDGET_USD", "SHARE_PER_PERSON_USD", "SHARE_MENTOR_USD", "SHARE_GENERAL_POOL_USD", "SHARE_MENTOR_POOL_USD"].forEach((k) => delete process.env[k]);
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
