// ④の全体レビュー（11/22 11:40）とほかのセッションの報告の直し（画面と見せる用の上限まわり）のテスト（API は使わない）。npm run test:reviewfix
import "./_isolate";
import fs from "node:fs";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf-8");
const CODE = "review-general-code-test";

async function main() {
  process.env.SHARE_MODE = "lan";
  process.env.ACCESS_CODE = CODE;
  process.env.SHARE_BUDGET_USD = "100";
  process.env.SHARE_PER_PERSON_USD = "2";
  process.env.SHARE_GENERAL_POOL_USD = "50";
  process.env.SHARE_STARTED_AT = "2026-11-21T00:00:00.000Z";
  const pb = await import("../lib/personBudget");
  const share = await import("../lib/share");
  const { recordUsage, chooseModels } = await import("../lib/usage");
  const model = chooseModels().loop;
  const spend = (id: string) => recordUsage(id, "loop", model, { input_tokens: 200_000, output_tokens: 20_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

  // ---- 1. 1人あたり・側ごとも「見せる用を起動してから」で数える ----
  const kA = pb.personKey("person-a");
  pb.runAsPerson(kA, () => spend("a1"), "general");
  const spentA = pb.personSpent(kA);
  const file = JSON.parse(fs.readFileSync(pb.personUsageFile(), "utf-8")) as { started_at?: string; people?: Record<string, unknown> };
  check("台帳に、見せる用を起動した時刻を持つ", file.started_at === "2026-11-21T00:00:00.000Z" && !!file.people?.[kA]);
  check("起動してからの分は数える", spentA > 0 && pb.poolSpent("general") === spentA);
  process.env.SHARE_STARTED_AT = "2026-11-21T01:00:00.000Z"; // 見せる用を起動し直した
  check("起動し直したら、1人あたりも側ごとも 0 から数える（合計の上限と同じ）", pb.personSpent(kA) === 0 && pb.poolSpent("general") === 0);
  fs.writeFileSync(pb.personUsageFile(), JSON.stringify({ [kA]: { usd: 99, calls: 1, last_at: "x" } }));
  check("前の形の台帳（起動の時刻なし）は、数えない", pb.personSpent(kA) === 0);
  check("合計の上限も同じ起動の時刻で数える（proxy.ts・lib/shareGate.ts は shareStartedAt）", share.shareStartedAt() === "2026-11-21T01:00:00.000Z" && read("lib/shareGate.ts").includes("spentSince(usage(), shareStartedAt())") && read("proxy.ts").includes("shareStartedAt()"));

  // ---- 2. 枠を取った直後にもう一度上限を見る ----
  const { afterSlot, shareBudgetGate } = await import("../lib/shareGate");
  while (pb.personSpent(kA) < 2) pb.runAsPerson(kA, () => spend("a2"), "general");
  let called = 0;
  const handler = afterSlot(async (_req: Request) => {
    called++;
    return new Response("ok");
  });
  const reqOf = (person: string) =>
    new Request("http://192.168.1.20:3100/api/agent", { method: "POST", headers: { host: "192.168.1.20:3100", cookie: `nb_access=${share.accessToken()}; ${pb.PERSON_COOKIE}=${person}` } });
  const over = await handler(reqOf("person-a"));
  check("枠を取ったあと、その人が上限を超えていたら始めない（429・処理は呼ばない）", over.status === 429 && called === 0);
  const fine = await handler(reqOf("person-b"));
  check("ほかの人は始められる", fine.status === 200 && called === 1);
  process.env.SHARE_BUDGET_USD = "0.01";
  check("合計の上限も、枠を取った直後に見る", !shareBudgetGate(reqOf("person-b")).ok);
  process.env.SHARE_BUDGET_USD = "100";
  const routes = ["agent", "draft", "blog-ideas", "events/[id]/analyze", "events/[id]/import", "venues", "venues/draft", "notebook"];
  const notWrapped = routes.filter((r) => !read(`app/api/${r}/route.ts`).includes("perPerson(slotted(afterSlot(handlePost)))"));
  check("枠を使う窓口は、すべて afterSlot で包む", !notWrapped.length, notWrapped.join(","));
  check("受信箱の追加・依頼として進める・もう一度探すも、枠を取った直後に見る", ["app/api/inbox/route.ts", "app/api/inbox/[id]/proceed/route.ts", "app/api/inbox/[id]/restart/route.ts"].every((f) => /withApiSlotHandoff\(req\.signal[\s\S]{0,300}shareBudgetGate\(req\)[\s\S]{0,80}release\(\)/.test(read(f))));

  // ---- 3. ネタ帳の更新の二重実行の止めは、見せる用では人ごと ----
  const nbSrc = read("app/api/notebook/route.ts");
  check("見せる用では人ごと・発表用は全員で1つ", nbSrc.includes('shareMode() === "lan" && req ? `visitor:${visitorKeyOf(req)}` : "all"'));
  const nb = await import("../app/api/notebook/route");
  const gl = globalThis as typeof globalThis & { __notebookUpdatingKeys?: Set<string> };
  (gl.__notebookUpdatingKeys ??= new Set()).add(`visitor:${pb.personKey("person-c")}`);
  const busyC = await nb.POST(new Request("http://192.168.1.20:3100/api/notebook", { method: "POST", headers: { host: "192.168.1.20:3100", cookie: `nb_access=${share.accessToken()}; ${pb.PERSON_COOKIE}=person-c` } }));
  check("見せる用：同じ人の2回目は 409", busyC.status === 409);
  gl.__notebookUpdatingKeys.clear();

  // ---- 4. 見せる用では API 代の合計を返さない ----
  const { forClient } = await import("../lib/clientView");
  const ev = { type: "done", run_usd: 0.2, total_usd: 12.3, nested: { models: { totalUsd: 12.3, loop: "x" } }, list: [{ total_usd: 1 }] };
  const cleaned = forClient(ev) as Record<string, unknown>;
  check("見せる用：total_usd・totalUsd をどの深さからも外す（run_usd は残す）", JSON.stringify(cleaned) === JSON.stringify({ type: "done", run_usd: 0.2, nested: { models: { loop: "x" } }, list: [{}] }), JSON.stringify(cleaned));
  const { GET: state } = await import("../app/api/state/route");
  const st = (await (await state(new Request("http://192.168.1.20:3100/api/state", { headers: { host: "192.168.1.20:3100" } }))).json()) as { models: Record<string, unknown> };
  check("見せる用：/api/state に合計（models.totalUsd）がない", !("totalUsd" in st.models) && "loop" in st.models);
  const sending = ["app/api/agent/route.ts", "app/api/events/[id]/analyze/route.ts", "app/api/notebook/route.ts", "app/api/venues/route.ts"].filter((f) => !read(f).includes("JSON.stringify(forClient(e))"));
  const json = ["app/api/draft/route.ts", "app/api/venues/draft/route.ts", "app/api/blog-ideas/route.ts", "app/api/inbox/[id]/detail/route.ts", "app/api/state/route.ts"].filter((f) => !read(f).includes("forClient("));
  check("合計を返しうる窓口は、すべて forClient を通す（作業ログの流れ・下書き・ブログ・依頼の詳細・状態）", !sending.length && !json.length, [...sending, ...json].join(","));
  delete process.env.SHARE_MODE;
  check("発表用ではそのまま返す", (forClient(ev) as { total_usd?: number }).total_usd === 12.3);

  // ---- 5. 見せる用の起動の表示も Wi-Fi を先に ----
  const serve = read("scripts/serve.mjs");
  check("起動の表示は、/share-links と同じ順（Wi-Fi → LAN → そのほか → 仮想の口・Tailscale）", serve.includes(".sort((a, b) => lanRank(a.name, a.ip) - lanRank(b.name, b.ip))") && /x === 100 && y >= 64 && y <= 127/.test(serve));
  const { lanRank } = await import("../lib/shareLinks");
  const cases: Array<[string, string]> = [["Wi-Fi", "192.168.17.81"], ["Tailscale", "100.82.52.98"], ["vEthernet (Default Switch)", "172.29.80.1"], ["イーサネット", "10.0.0.5"]];
  // serve.mjs の lanRank を取り出して、lib/shareLinks.ts と同じ答えになるか確かめる
  const fnSrc = serve.slice(serve.indexOf("const lanRank = (name, ip) => {"), serve.indexOf("const lanIps"));
  const serveRank = new Function(`${fnSrc}; return lanRank;`)() as (n: string, ip: string) => number;
  check("serve.mjs と lib/shareLinks.ts の順位が同じ", cases.every(([name, ip]) => serveRank(name, ip) === lanRank({ name, ip })));

  // ---- 6. GET /api/feedback で窓口を確かめない ----
  check("画面は GET /api/feedback を送らない（405 がコンソールに出ない）", !/safeFetch\("\/api\/feedback", \{ method: "GET" \}\)/.test(read("app/_client/api.ts")));

  // ---- 7. 会話を貼った直後にタブを切り替えても、受信箱に戻さない ----
  const page = read("app/page.tsx");
  check("追加を待つ間にタブを移っていたら、受信箱に引き戻さない", /await loadInbox\(\);\s*\/\/[^\n]*\n\s*if \(tabRef\.current !== "inbox"\) return;\s*await openInbox\(id\);/.test(page) && page.includes("tabRef.current = t;"));

  ["SHARE_MODE", "ACCESS_CODE", "SHARE_BUDGET_USD", "SHARE_PER_PERSON_USD", "SHARE_GENERAL_POOL_USD", "SHARE_STARTED_AT"].forEach((k) => delete process.env[k]);
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
