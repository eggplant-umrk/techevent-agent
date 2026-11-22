// 見せる用のメンター用の合言葉（MENTOR_ACCESS_CODE）のテスト（API は使わない）。npm run test:mentor
//   - 一般の合言葉と同じ守り（12文字以上・回数の制限・全体の上限・値を表示しない）
//   - メンターは1人あたりの上限が SHARE_MENTOR_USD、一般は SHARE_PER_PERSON_USD
//   - メンターの印（nb_role）は合言葉から作ったハッシュで、偽れない。役割は画面に出さない
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
const CODE = "general-code-for-test";
const MENTOR = "mentor-code-for-test";

async function main() {
  process.env.SHARE_MODE = "lan";
  process.env.ACCESS_CODE = CODE;
  process.env.SHARE_BUDGET_USD = "50";
  process.env.SHARE_PER_PERSON_USD = "5";
  process.env.SHARE_MENTOR_USD = "15";
  process.env.MENTOR_ACCESS_CODE = MENTOR;
  const share = await import("../lib/share");
  const pb = await import("../lib/personBudget");
  const guard = await import("../lib/accessGuard");

  // ---- 設定 ----
  check("メンター用の合言葉と上限がそろえば起動できる", share.shareConfigProblem() === null);
  process.env.MENTOR_ACCESS_CODE = "short-mtr";
  check("メンター用の合言葉が12文字未満なら、起動を止める理由がある（値は出さない）", !!share.shareConfigProblem()?.includes("12文字以上") && !share.shareConfigProblem()!.includes("short-mtr"));
  process.env.MENTOR_ACCESS_CODE = CODE;
  check("メンター用の合言葉が一般と同じなら、起動を止める理由がある", !!share.shareConfigProblem()?.includes("別のもの"));
  process.env.MENTOR_ACCESS_CODE = MENTOR;
  process.env.SHARE_MENTOR_USD = "abc";
  check("SHARE_MENTOR_USD が数でなければ、起動を止める理由がある", !!share.shareConfigProblem()?.includes("SHARE_MENTOR_USD"));
  process.env.SHARE_MENTOR_USD = "15";
  const tmp = fs.mkdtempSync(path.join(path.dirname(process.env.DATA_RUNTIME_DIR!), "serve-mentor-"));
  const cfg = (env: Record<string, string>) =>
    spawnSync(process.execPath, [path.join(process.cwd(), "scripts", "serve.mjs"), "start", "--share", "--print-config"], {
      cwd: tmp,
      encoding: "utf-8",
      env: { ...process.env, SHARE_MODE: "", ACCESS_CODE: CODE, SHARE_BUDGET_USD: "5", MENTOR_ACCESS_CODE: MENTOR, SHARE_MENTOR_USD: "15", ...env },
      timeout: 30000,
    });
  const okCfg = cfg({});
  check("見せる用の起動：メンター用の合言葉があっても起動でき、値は出さない", okCfg.status === 0 && !okCfg.stdout.includes(MENTOR) && okCfg.stdout.includes('"mentor_code_set":true'));
  const shortCfg = cfg({ MENTOR_ACCESS_CODE: "short-mtr" });
  check("見せる用の起動：メンター用の合言葉が12文字未満なら起動しない（値は出さない）", shortCfg.status === 1 && shortCfg.stderr.includes("MENTOR_ACCESS_CODE") && !shortCfg.stderr.includes("short-mtr"));
  check("見せる用の起動：メンター用が一般と同じなら起動しない", cfg({ MENTOR_ACCESS_CODE: CODE }).status === 1);
  check("見せる用の起動：メンター用の合言葉なしでも起動できる（任意）", cfg({ MENTOR_ACCESS_CODE: "", SHARE_MENTOR_USD: "" }).status === 0);
  fs.rmSync(tmp, { recursive: true, force: true });

  // ---- 合言葉の窓口 ----
  guard.clearAccessGuard();
  const { POST: access } = await import("../app/api/access/route");
  const tryCode = (code: string, ip = "192.168.1.40", cookie = "") =>
    access(new Request("http://192.168.1.20:3100/api/access", { method: "POST", headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ code }) }));
  const m = await tryCode(MENTOR);
  const mCookies = m.headers.getSetCookie();
  const mRole = mCookies.find((c) => c.startsWith(`${share.MENTOR_COOKIE}=`)) ?? "";
  check("メンター用の合言葉で入れる（返事の形は一般と同じ）", m.status === 200 && JSON.stringify(await m.json()) === '{"ok":true}');
  check("メンターの印（httpOnly）を付け、合言葉そのものは入れない", mRole.includes(share.mentorToken()) && /HttpOnly/.test(mRole) && !mCookies.join(";").includes(MENTOR));
  const g = await tryCode(CODE, "192.168.1.41");
  const gRole = g.headers.getSetCookie().find((c) => c.startsWith(`${share.MENTOR_COOKIE}=`)) ?? "";
  check("一般の合言葉で入ったら、メンターの印は外す（入り直しで役割が残らない）", g.status === 200 && /Max-Age=0/.test(gRole));
  const sts: number[] = [];
  for (let i = 0; i < 5; i++) sts.push((await tryCode("mentor-code-guess", "192.168.1.42")).status);
  check("メンター用の合言葉も同じ回数の制限（5回目で 429）", sts.slice(0, 4).every((s) => s === 401) && sts[4] === 429, sts.join(","));
  const lockedMentor = await tryCode(MENTOR, "192.168.1.42");
  check("止められている間は、メンター用の合言葉でも入れない", lockedMentor.status === 429);
  guard.clearAccessGuard();

  // ---- 役割と上限 ----
  const H = (cookie: string) => new Request("http://192.168.1.20:3100/api/state", { headers: { host: "192.168.1.20:3100", cookie } });
  const mentorCookie = `nb_access=${share.accessToken()}; ${pb.PERSON_COOKIE}=mentor-person; ${share.MENTOR_COOKIE}=${share.mentorToken()}`;
  const generalCookie = `nb_access=${share.accessToken()}; ${pb.PERSON_COOKIE}=general-person`;
  check("メンターの印があれば mentor", pb.roleOf(H(mentorCookie)) === "mentor");
  check("印がなければ general", pb.roleOf(H(generalCookie)) === "general");
  check("偽の印（ハッシュが違う）は general", pb.roleOf(H(`${generalCookie}; ${share.MENTOR_COOKIE}=mentor`)) === "general");
  process.env.MENTOR_ACCESS_CODE = "another-mentor-code";
  check("メンター用の合言葉を変えたら、前の印は general（合言葉を捨てたあとに使い回せない）", pb.roleOf(H(mentorCookie)) === "general");
  process.env.MENTOR_ACCESS_CODE = MENTOR;
  check("1人あたりの上限：メンター $15・一般 $5", pb.perPersonUsd("mentor") === 15 && pb.perPersonUsd("general") === 5);
  process.env.SHARE_MENTOR_USD = "";
  check("SHARE_MENTOR_USD が空なら、メンターも一般と同じ上限", pb.perPersonUsd("mentor") === 5);
  process.env.SHARE_MENTOR_USD = "15";

  // 使い切りの判定：$6 使ったメンターは続けられ、一般は止まる
  const { recordUsage, chooseModels } = await import("../lib/usage");
  const model = chooseModels().loop;
  const spend = (id: string) => recordUsage(id, "loop", model, { input_tokens: 200_000, output_tokens: 20_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  const kM = pb.personKey("mentor-person");
  const kG = pb.personKey("general-person");
  while (pb.personSpent(kM) < 6) pb.runAsPerson(kM, () => spend("m"), "mentor");
  while (pb.personSpent(kG) < 6) pb.runAsPerson(kG, () => spend("g"), "general");
  check("メンター：$6 使っても続けられる（上限 $15）", pb.checkPerson(kM, "mentor").ok);
  check("一般：$6 使ったら止まる（上限 $5）", !pb.checkPerson(kG, "general").ok);
  const ledger = JSON.parse(fs.readFileSync(pb.personUsageFile(), "utf-8")) as Record<string, { role?: string }>;
  check("人ごとの記録に、メンターは role: mentor（一般は付けない）", ledger[kM]?.role === "mentor" && ledger[kG]?.role === undefined);
  check("いまの人の役割（実行の記録に付けるため）：窓口の中では mentor、外では null", pb.runAsPerson(kM, () => pb.currentRole(), "mentor") === "mentor" && pb.currentRole() === null);

  const { proxy } = await import("../proxy");
  const { NextRequest } = await import("next/server");
  const post = (cookie: string) => proxy(new NextRequest("http://192.168.1.20:3100/api/agent", { method: "POST", headers: { host: "192.168.1.20:3100", origin: "http://192.168.1.20:3100", cookie } }));
  check("入口：$6 使ったメンターの API を使う操作は通す", post(mentorCookie).headers.get("x-middleware-next") === "1");
  check("入口：$6 使った一般の人は 429", post(generalCookie).status === 429);
  const { GET: state } = await import("../app/api/state/route");
  const sM = (await (await state(H(mentorCookie))).json()) as { share: { person_remaining_usd: number }; role?: unknown };
  check("メンターの残りは $15 から数える（画面にはこの数だけ。役割は出さない）", Math.abs(sM.share.person_remaining_usd - (15 - pb.personSpent(kM))) < 1e-6 && !JSON.stringify(sM).includes("mentor"));

  // ---- ヘッダーの合言葉（スクリプト） ----
  check("メンター用の合言葉はヘッダー（X-Access-Code）でも通る", share.checkRequest({ method: "GET", pathname: "/api/cards", host: "192.168.1.20:3100", origin: null, forwardedFor: null, cookie: null, headerCode: MENTOR }).ok);

  // ---- 文書 ----
  const envEx = read(".env.example");
  const doc = read("docs/demo_checklist.md");
  check(".env.example に MENTOR_ACCESS_CODE・SHARE_MENTOR_USD と「Notion に書かず口頭で」", envEx.includes("MENTOR_ACCESS_CODE=") && envEx.includes("SHARE_MENTOR_USD=") && envEx.includes("Notion に書かず") && envEx.includes("口頭"));
  check("docs/demo_checklist.md に「Notion に書くのは 3100番のアドレスだけ」「メンター用は口頭で」", doc.includes("Notion に書くのは見せる用（3100番）のアドレスだけ") && doc.includes("口頭で伝える"));
  check("画面に役割を出さない（見た目は一般と同じ）", !/mentor|メンター/.test(read("components/Header.tsx") + read("app/page.tsx")));

  ["SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD", "SHARE_PER_PERSON_USD", "SHARE_MENTOR_USD", "MENTOR_ACCESS_CODE"].forEach((k) => delete process.env[k]);
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
