// 窓口の入口・API 代の上限・登壇者の評価の写り込み・個人情報の伏せ方のテスト（APIは使わない・data/ に書き込まない）。
//   npm run test:security
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}
const ENV_KEYS = ["SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD", "SHARE_STARTED_AT", "BIND_HOST"];
const clearEnv = () => ENV_KEYS.forEach((k) => delete process.env[k]);

async function main() {
  clearEnv();
  const share = await import("../lib/share");
  const { checkRequest, checkBudget, spentSince, accessToken, shareConfigProblem, ACCESS_COOKIE } = share;
  const req = (p: Partial<Parameters<typeof checkRequest>[0]>) =>
    checkRequest({ method: "GET", pathname: "/api/inbox", host: "127.0.0.1:3000", origin: null, forwardedFor: null, cookie: null, headerCode: null, ...p });

  // ---- 既定：localhost からだけ
  check("既定：localhost からの /api は通す", req({}).ok);
  check("既定：同じ画面（Origin が localhost）からの POST は通す", req({ method: "POST", origin: "http://127.0.0.1:3000" }).ok && req({ method: "POST", host: "localhost:3000", origin: "http://localhost:3000" }).ok);
  const ext = req({ host: "192.168.1.20:3000" });
  check("既定：外の Host は弾く（403）", !ext.ok && ext.status === 403);
  const evil = req({ method: "POST", origin: "https://evil.example" });
  check("既定：外の Origin からの /api は弾く（403）", !evil.ok && evil.status === 403);
  check("既定：転送元が外なら弾く", !req({ forwardedFor: "203.0.113.5" }).ok);
  check("既定：画面も外の Host は弾く", !req({ pathname: "/", host: "192.168.1.20:3000" }).ok);
  const { isLocalRequest } = await import("../lib/localOnly");
  check("既定：窓口ごとの確認（isLocalRequest）も外を弾く", !isLocalRequest(new Request("http://192.168.1.20:3000/api/inbox", { headers: { host: "192.168.1.20:3000" } })));

  // ---- lan：合言葉が要る
  process.env.SHARE_MODE = "lan";
  check("lan で合言葉が空なら、起動を止める理由がある", !!shareConfigProblem()?.includes("ACCESS_CODE"));
  check("lan で合言葉が空なら、どの窓口も使えない（503）", !req({}).ok && (req({}) as { status: number }).status === 503);
  process.env.ACCESS_CODE = "sakura-2026";
  const lan = (p: Partial<Parameters<typeof checkRequest>[0]>) => req({ host: "192.168.1.20:3000", ...p });
  const noCode = lan({});
  check("lan：合言葉なしの /api は弾く（401）", !noCode.ok && noCode.status === 401);
  const page = lan({ pathname: "/" });
  check("lan：合言葉なしで画面を開くと、合言葉の入力へ", !page.ok && page.status === 303 && page.redirectTo === "/access?next=%2F");
  check("lan：合言葉の入力画面と送り先は開ける", lan({ pathname: "/access" }).ok && lan({ method: "POST", pathname: "/api/access", origin: "http://192.168.1.20:3000" }).ok);
  check("lan：印（cookie）があれば通す", lan({ cookie: accessToken() }).ok && lan({ pathname: "/", cookie: accessToken() }).ok);
  check("lan：違う印は弾く", !lan({ cookie: accessToken("wrong") }).ok);
  check("lan：同じ端末のスクリプトは X-Access-Code で通す", lan({ host: "127.0.0.1:3000", headerCode: "sakura-2026" }).ok && !lan({ host: "127.0.0.1:3000" }).ok);
  check("lan：Host が localhost でも合言葉なしでは通さない（Host は偽れるため）", !lan({ host: "localhost:3000" }).ok);
  const other = lan({ method: "POST", cookie: accessToken(), origin: "http://192.168.1.99:3000" });
  check("lan：Origin が自分のホストと違えば弾く（403）", !other.ok && other.status === 403);
  check("lan：Origin が自分のホストなら通す", lan({ method: "POST", cookie: accessToken(), origin: "http://192.168.1.20:3000" }).ok);
  check("印に合言葉そのものは入れない", !accessToken().includes("sakura"));
  check("lan：窓口ごとの確認（isLocalRequest）は入口に任せる", isLocalRequest(new Request("http://192.168.1.20:3000/api/inbox", { headers: { host: "192.168.1.20:3000" } })));

  // 合言葉の送り先
  const { POST: accessPost } = await import("../app/api/access/route");
  const wrong = await accessPost(new Request("http://192.168.1.20:3000/api/access", { method: "POST", body: JSON.stringify({ code: "nope" }) }));
  check("合言葉が違えば 401", wrong.status === 401 && !wrong.headers.get("set-cookie"));
  const right = await accessPost(new Request("http://192.168.1.20:3000/api/access", { method: "POST", body: JSON.stringify({ code: "sakura-2026" }) }));
  const cookie = right.headers.get("set-cookie") ?? "";
  check("合言葉が合えば、httpOnly の印を付ける（合言葉そのものは入れない）", right.status === 200 && cookie.startsWith(`${ACCESS_COOKIE}=${accessToken()}`) && /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie) && !cookie.includes("sakura"));

  // 入口（proxy.ts）を通しで
  const { proxy } = await import("../proxy");
  const { NextRequest } = await import("next/server");
  const via = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => proxy(new NextRequest(url, { method: init.method ?? "GET", headers: init.headers }));
  const r1 = via("http://192.168.1.20:3000/api/cards", { headers: { host: "192.168.1.20:3000" } });
  check("入口：lan で合言葉なしの /api は 401", r1.status === 401);
  const r2 = via("http://192.168.1.20:3000/", { headers: { host: "192.168.1.20:3000" } });
  check("入口：lan で合言葉なしの画面は /access へ", r2.status === 303 && (r2.headers.get("location") ?? "").includes("/access?next="));
  const r3 = via("http://192.168.1.20:3000/api/cards", { headers: { host: "192.168.1.20:3000", cookie: `${ACCESS_COOKIE}=${accessToken()}` } });
  check("入口：lan で印があれば通す", r3.status === 200 && r3.headers.get("x-middleware-next") === "1");
  clearEnv();
  const r4 = via("http://192.168.1.20:3000/api/cards", { headers: { host: "192.168.1.20:3000" } });
  check("入口：既定で外の Host は 403", r4.status === 403);
  const r5 = via("http://127.0.0.1:3000/api/cards", { headers: { host: "127.0.0.1:3000" } });
  check("入口：既定で localhost は通す", r5.headers.get("x-middleware-next") === "1");

  // ---- 起動の止め方（scripts/serve.mjs）：.env のない場所で、設定を環境変数で渡す
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "serve-test-"));
  const serve = path.join(process.cwd(), "scripts", "serve.mjs");
  const run = (env: Record<string, string>) => spawnSync(process.execPath, [serve, "dev"], { cwd: tmp, env: { ...process.env, ...env }, encoding: "utf-8", timeout: 10000 });
  const s1 = run({ SHARE_MODE: "lan", ACCESS_CODE: "" });
  check("起動：lan で合言葉が空なら止める", s1.status === 1 && s1.stderr.includes("ACCESS_CODE"));
  const s2 = run({ BIND_HOST: "0.0.0.0" });
  check("起動：既定のまま localhost 以外で待ち受けようとしたら止める", s2.status === 1 && s2.stderr.includes("SHARE_MODE=lan"));
  fs.rmSync(tmp, { recursive: true, force: true });
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf-8")) as { scripts: Record<string, string> };
  check("package.json の dev と start は serve.mjs（BIND_HOST、既定 127.0.0.1）を通す", pkg.scripts.dev.includes("serve.mjs dev") && pkg.scripts.start.includes("serve.mjs start"));
  check("serve.mjs の既定の待ち受け先は 127.0.0.1", /: "127\.0\.0\.1"/.test(fs.readFileSync(serve, "utf-8")));

  // ---- API 代の上限
  process.env.SHARE_BUDGET_USD = "5";
  const recs = [
    { at: "2026-11-21T09:00:00Z", cost_usd: 10 },
    { at: "2026-11-22T10:00:00Z", cost_usd: 3 },
    { at: "2026-11-22T11:00:00Z", cost_usd: 2.5 },
  ];
  check("見せている間の金額は、始めてからの記録だけ", spentSince(recs, "2026-11-22T00:00:00Z") === 5.5);
  const over = checkBudget("POST", "/api/agent", 5.5);
  check("上限を超えたら、API を使う操作を止める（429・理由つき）", !over.ok && over.status === 429 && over.error.includes("$5"));
  for (const p of ["/api/notebook", "/api/events/ev020/analyze", "/api/draft", "/api/inbox", "/api/venues", "/api/venues/draft", "/api/blog-ideas", "/api/events/ev020/import"])
    if (checkBudget("POST", p, 5.5).ok) check(`上限を超えたら止める：${p}`, false);
  check("候補・ネタ帳の更新・分析・下書き・出し先・ブログ・取り込み・受信箱への追加を止める", true);
  check("見るだけの操作（GET）と、API を使わない操作（結果の記録）は止めない", checkBudget("GET", "/api/cards", 99).ok && checkBudget("POST", "/api/outcome", 99).ok);
  check("上限より下なら止めない", checkBudget("POST", "/api/agent", 4.99).ok);
  process.env.SHARE_STARTED_AT = "2000-01-01T00:00:00Z";
  process.env.SHARE_BUDGET_USD = "0.000001";
  const usageFile = path.join(process.cwd(), "data", "usage.json");
  const hasUsage = fs.existsSync(usageFile) && (JSON.parse(fs.readFileSync(usageFile, "utf-8")) as unknown[]).length > 0;
  if (hasUsage) {
    const mod = await import(`../proxy?budget=${Date.now()}`);
    const r6 = mod.proxy(new NextRequest("http://127.0.0.1:3000/api/agent", { method: "POST", headers: { host: "127.0.0.1:3000" } }));
    const body = (await r6.json()) as { error?: string };
    check("入口：上限を超えていれば、候補を出す操作を 429 で止めて理由を返す（usage の記録から計算）", r6.status === 429 && !!body.error?.includes("上限"));
  } else check("（data/usage.json がないので、入口での上限の確認は省略）", true);
  clearEnv();

  // ---- 登壇者の評価の写り込み（提出時の検査と作業ログ）
  const { speakerEvaluationProblems } = await import("../lib/surveys");
  const rec = { id: "tr-x", card_id: "card-e004-01", speaker_id: "e004", event_id: "ev020", event_title: "x", event_date: "2026-10-30", answers: 12, talk_average: 4.2, summary: "整合性の考え方が具体的で参考になったという声が多い", good_themes: ["データ整合性を守るための考え方が参考になった（5件）"], content_fact: "前回は前提知識の多さを指摘する声が3件", recorded_at: "" };
  const probs = (t: string) => speakerEvaluationProblems([{ where: "理由", text: t }], [rec]);
  check("登壇者の記録の文と重なる理由は差し戻す", probs("前回は整合性の考え方が具体的で参考になったと好評でした").length > 0);
  check("記録の良かった点のテーマを写すと差し戻す", probs("データ整合性を守るための考え方を話せます").length > 0);
  check("点数・満足度・回答の件数の言い方は差し戻す", ["前回の満足度は高めでした", "登壇の点数の平均4.2", "12件の回答で好評", "前回は反応が良かった"].every((t) => probs(t).length > 0));
  check("取り組みの中身だけの理由は通す", probs("金融とSaaSの整合性を、二重記帳の図で説明できる取り組みがあります").length === 0);
  const { validateSubmit, THINKING_NOTE } = await import("../lib/agent");
  const { requests } = await import("../lib/data");
  const errs = validateSubmit(
    { request_pattern: "open", summary: "前回の満足度が高い人を選びました", nominee_assessment: null, learnings_applied: [], no_fit: null, candidates: [] } as never,
    new Set(),
    null,
    requests()[0],
  );
  check("提出時：登壇者の評価の言い方があれば差し戻す", errs.some((e) => e.includes("登壇者の評価")), errs.find((e) => e.includes("登壇者の評価")) ?? "");
  const agentSrc = fs.readFileSync(path.join("lib", "agent.ts"), "utf-8");
  check("考えた内容は返させない（thinking の display は omitted）", agentSrc.includes('display: "omitted"') && !agentSrc.includes('display: "summarized"'));
  check("作業ログの考えている途中は「考えています」だけ", THINKING_NOTE === "考えています" && agentSrc.includes("emit({ type: \"thinking\", text: THINKING_NOTE })"));
  const inboxSrc = fs.readFileSync(path.join("lib", "inbox.ts"), "utf-8");
  check("前に保存した作業ログの考えた内容も、画面には出さない", inboxSrc.includes('e.type === "thinking" ? { ...e, text: "考えています" }'));

  // ---- アンケートの列の見本で個人情報を送らない
  const { scrubPersonal, detectColumns, importSurveyCsv } = await import("../lib/surveyCsv");
  check("全角の＠のメールアドレスも伏せる", scrubPersonal("ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ まで").includes("［メールアドレスを削除］"));
  check("全角数字・空白区切りの電話番号も伏せる", scrubPersonal("０９０ １２３４ ５６７８").includes("［電話番号を削除］"));
  check("かっこ区切りの電話番号も伏せる", scrubPersonal("(03) 1234-5678").includes("［電話番号を削除］") && scrubPersonal("+81 90-1234-5678").includes("［電話番号を削除］"));
  check("X のアカウント（@...）も伏せる", scrubPersonal("Xは @layerx_dev です").includes("［アカウントを削除］"));
  check("伏せるものがない文は原文のまま（日付・人数も消さない）", scrubPersonal("2026年11月21日に100人来て、とても良かった！") === "2026年11月21日に100人来て、とても良かった！");
  const cols = detectColumns(["Name", "会社", "ご所属", "X（旧Twitter）のアカウント", "Twitter", "Company", "Xを使った感想", "満足度"]).map((c) => c.role);
  check("Name・会社・所属・X・Twitter・Company の列は個人情報として捨てる", cols.slice(0, 6).every((r) => r === "personal"), cols.join(","));
  check("「Xを使った感想」のような列は個人情報にしない", cols[6] === "comment");
  const asked: Array<{ header: string; samples: string[] }> = [];
  const ev = (await import("../lib/data")).events().find((e) => e.id === "ev020")!;
  await importSurveyCsv(ev.id, `満足度,ふりかえり欄\n5,taro@example.com 090-1234-5678\n4,山田です`, {
    source: "upload",
    asker: async (c) => {
      asked.push(...c);
      return [];
    },
  });
  check("意味が分からない列は、見本の値を送らず質問文だけで聞く", asked.length === 1 && asked[0].header === "ふりかえり欄" && asked[0].samples.length === 0);
  const csvSrc = fs.readFileSync(path.join("lib", "surveyCsv.ts"), "utf-8");
  check("列を聞く文に見本の値を入れない", !csvSrc.includes("見本：${c.samples"));

  console.log(failed ? `\n${failed}件 不合格` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
