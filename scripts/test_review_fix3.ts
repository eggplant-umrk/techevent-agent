// ④の全体レビュー（11/22）の直しのうち、受信箱と見せる用まわりのテスト（本物の API は使わない・data/ に書き込まない）。
//   npx tsx scripts/test_review_fix3.ts
// 見るもの：受信箱の「もう一度探す」（restart）が受信箱に保存する／見せる用の同時実行は1人1件・全体6件（発表用は2件のまま）／
//           枠を取ったあとに失敗しても枠が返る／評価のケースにするときの個人情報の落とし方（全角半角・姓・URL のアカウント名）
import "./_isolate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "review-fix3-"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // ---- 1. 受信箱の「もう一度探す」
  console.log("\n━ 1. 受信箱の「もう一度探す」");
  const inbox = await import("../lib/inbox");
  const { requests } = await import("../lib/data");
  type Runner = Parameters<typeof inbox.restart>[1];
  const fixture = JSON.parse(fs.readFileSync(path.join("app", "_client", "proposals.json"), "utf-8")) as Record<string, { result: unknown }>;
  const anyResult = Object.values(fixture)[0]?.result as Awaited<ReturnType<Runner>>;
  let calls = 0;
  let fail = true;
  const runner: Runner = async (request, emit) => {
    calls++;
    await sleep(30);
    if (fail) {
      emit({ type: "error", message: "試験のエラー" });
      return null;
    }
    return anyResult ? { ...anyResult, request_id: request.id } : null;
  };
  let first = false;
  const item = inbox.addToInbox({ text: "12月15日の勉強会で、生成AIの活用について20分話せる方を探しています", source: "manual" }, runner, undefined, () => (first = true));
  for (let i = 0; i < 100 && !first; i++) await sleep(20);
  check("最初の準備が失敗して「エラー」になる", inbox.getInboxItem(item.id)?.status === "error");
  let settled = 0;
  const r1 = inbox.restart(item.id, runner, undefined, () => settled++);
  check("restart は受け付ける", r1.ok);
  check("準備中になる", inbox.getInboxItem(item.id)?.status === "processing");
  const r2 = inbox.restart(item.id, runner);
  check("準備中にもう一度は断る（準備中です）", !r2.ok && r2.error === "準備中です");
  for (let i = 0; i < 100 && settled === 0; i++) await sleep(20);
  check("失敗したらエラーとして受信箱に保存し、終わったら枠を返す（onSettled）", inbox.getInboxItem(item.id)?.status === "error" && settled === 1);
  fail = false;
  inbox.restart(item.id, runner, undefined, () => settled++);
  for (let i = 0; i < 100 && settled === 1; i++) await sleep(20);
  const saved = inbox.getInboxItem(item.id);
  check("エラーからの押し直しで、結果が受信箱に保存される（ready・候補あり）", saved?.status === "ready" && (saved.result?.candidates.length ?? 0) > 0 && settled === 2, `${saved?.status} ${saved?.error ?? ""}`);
  check("受信箱にない依頼は断る", !inbox.restart("inb-nai", runner).ok);
  check("サンプルの依頼の id は受信箱にないので、restart では扱わない（今までどおり /api/agent）", !inbox.restart(requests()[0].id, runner).ok);
  check("画面は受信箱の依頼（サンプル以外）の「もう一度探す」で restart の窓口を呼ぶ", /inbox\.source !== "sample"[\s\S]{0,200}api\.inboxRestart\(id\)/.test(fs.readFileSync(path.join("app", "page.tsx"), "utf-8")));
  check("restart の窓口は、見せる用で API を使う操作として数える（上限の対象）", (await import("../lib/share")).spendsApi("POST", `/api/inbox/${item.id}/restart`));

  // ---- 2. 同時実行の上限
  console.log("\n━ 2. 同時実行の上限");
  const slots = await import("../lib/apiSlots");
  const vs = await import("../lib/visitorScope");
  const { visitorKey } = await import("../lib/visitor");
  check("発表用：全体2件・人で数えない（今のまま）", slots.maxApiSlots() === 2 && slots.perPersonApiSlots() === null);
  process.env.SHARE_MODE = "lan";
  check("見せる用：既定は1人1件・全体6件", slots.maxApiSlots() === 6 && slots.perPersonApiSlots() === 1);
  process.env.SHARE_API_MAX_CONCURRENT = "3";
  process.env.SHARE_API_PER_PERSON = "2";
  check("設定（SHARE_API_MAX_CONCURRENT・SHARE_API_PER_PERSON）で変えられる", slots.maxApiSlots() === 3 && slots.perPersonApiSlots() === 2);
  delete process.env.SHARE_API_MAX_CONCURRENT;
  delete process.env.SHARE_API_PER_PERSON;
  const people = Array.from({ length: 8 }, (_, i) => visitorKey(`person-${i}`)!);
  const as = <T>(i: number, fn: () => T) => vs.withVisitor(people[i], fn);
  const a = as(0, () => slots.acquireApiSlot());
  const a2 = as(0, () => slots.acquireApiSlot());
  check("見せる用：同じ人の2件目は取れない", !!a && a2 === null);
  const msg = await as(0, () => slots.apiBusyResponse().json());
  check("断る理由は「この端末の操作がもう1件」", /この端末の API を使う操作がもう1件/.test(msg.error), msg.error);
  const others = [1, 2, 3, 4, 5].map((i) => as(i, () => slots.acquireApiSlot()));
  check("ほかの人は取れる（全体6件まで）", others.every(Boolean) && slots.busyApiSlots() === 6);
  check("7人目は取れない（全体の上限）", as(6, () => slots.acquireApiSlot()) === null);
  const msg7 = await as(6, () => slots.apiBusyResponse().json());
  check("全体の上限の理由は「同時に6件」", /同時に6件/.test(msg7.error), msg7.error);
  // 待ち：人0の2件目と人6が待つ。人1が返したら、人0（まだ1件持っている）は飛ばして、人6が始める
  const w0 = as(0, () => slots.acquireApiSlotWait(null, 2000));
  const w6 = as(6, () => slots.acquireApiSlotWait(null, 2000));
  check("待っている人がいる", slots.waitingApiSlots() === 2);
  others[0]!();
  const g6 = await Promise.race([w6, sleep(500).then(() => "まだ" as const)]);
  check("空いたら、始められる人（人6）に渡す。自分の1件が動いている人（人0）は、ほかの人を止めない", typeof g6 === "function" && slots.waitingApiSlots() === 1);
  a!();
  const g0 = await Promise.race([w0, sleep(500).then(() => "まだ" as const)]);
  check("人0は自分の1件を返したら、待っていた2件目が始まる", typeof g0 === "function" && slots.busyApiSlotsOf(people[0]) === 1);
  for (const r of [g0, g6, ...others.slice(1)]) if (typeof r === "function") r();
  check("全部返したら0件（人ごとの数も残らない）", slots.busyApiSlots() === 0 && slots.busyApiSlotsOf(people[0]) === 0 && slots.busyApiSlotsOf(people[6]) === 0);
  delete process.env.SHARE_MODE;

  // ---- 3. 枠を取ったあとに失敗しても返す
  console.log("\n━ 3. 枠を取ったあとに失敗しても返す");
  const thrown = await slots.withApiSlotHandoff(null, () => {
    throw new Error("保存に失敗");
  }).then(() => null, (e: unknown) => e);
  check("裏へ渡す前に投げたら、枠を返して投げ直す", thrown instanceof Error && slots.busyApiSlots() === 0, `使用中 ${slots.busyApiSlots()}`);
  let handed: (() => void) | null = null;
  const ok = await slots.withApiSlotHandoff(null, (release) => {
    handed = release;
    return Response.json({ ok: true });
  });
  check("裏へ渡したら、裏が返すまで枠を持つ", ok.status === 200 && slots.busyApiSlots() === 1);
  (handed as (() => void) | null)?.();
  check("裏が返したら0件", slots.busyApiSlots() === 0);
  const routes = ["app/api/inbox/route.ts", "app/api/inbox/[id]/proceed/route.ts", "app/api/inbox/[id]/restart/route.ts"];
  for (const r of routes) {
    const src = fs.readFileSync(r, "utf-8");
    check(`${r}：枠を取ったあとを withApiSlotHandoff で包む（acquireApiSlotWait を直に使わない）`, src.includes("withApiSlotHandoff(req.signal") && !src.includes("acquireApiSlotWait"));
  }

  // ---- 5. 個人情報の落とし方
  console.log("\n━ 5. 個人情報の落とし方");
  const fe = await import("../lib/feedbackEval");
  const keep = fe.employeeNameSet(["鈴木 一郎", "Hanako Sato"]);
  const s = (t: string) => fe.scrubText(t, keep);
  check("「山田 太郎さん」は姓ごと落とす", s("山田 太郎さんからの依頼です") === "（名前）さんからの依頼です", s("山田 太郎さんからの依頼です"));
  check("全角の空白（山田　太郎さん）も姓ごと落とす", !/山田|太郎/.test(s("担当は山田　太郎さんです")), s("担当は山田　太郎さんです"));
  check("「山田 太郎と申します」も姓ごと", !/山田|太郎/.test(s("山田 太郎と申します")), s("山田 太郎と申します"));
  check("社員の実名（鈴木 一郎さん）は残す", s("鈴木 一郎さんにお願いしたい") === "鈴木 一郎さんにお願いしたい");
  check("全角の電話（０９０－１２３４－５６７８）を落とす", !/1234|１２３４/.test(s("電話は０９０－１２３４－５６７８まで")), s("電話は０９０－１２３４－５６７８まで"));
  check("全角のかっこの電話（０３（１２３４）５６７８）を落とす", !/1234|5678/.test(s("ＴＥＬ：０３（１２３４）５６７８")), s("ＴＥＬ：０３（１２３４）５６７８"));
  check("全角のメールを落とす", !/taro|example/i.test(s("ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ")), s("ｔａｒｏ＠ｅｘａｍｐｌｅ．ｃｏｍ"));
  check("全角の＠アカウントを落とす", !/hanako/i.test(s("Ｘは＠ｈａｎａｋｏ＿ｙです")), s("Ｘは＠ｈａｎａｋｏ＿ｙです"));
  for (const u of [
    "https://x.com/hanako_y",
    "https://twitter.com/hanako_y/status/123",
    "https://github.com/hanako-y/repo",
    "https://www.linkedin.com/in/hanako-y/",
    "https://connpass.com/user/hanako_y/",
    "https://hanako.hatenablog.com/entry/1",
    "https://zenn.dev/hanako_y",
    "https://bsky.app/profile/hanako.bsky.social",
    "ｈｔｔｐｓ：／／ｘ．ｃｏｍ／ｈａｎａｋｏ＿ｙ",
  ]) {
    const out = s(`プロフィール：${u} です`);
    check(`URL の中のアカウント名を落とす：${u}`, !/hanako/i.test(out), out);
  }
  check("イベントのページの URL はそのまま", s("告知：https://connpass.com/event/12345/ です").includes("https://connpass.com/event/12345/"));

  // ---- 6. 人の置き場所の上限と、起動時の片付け
  console.log("\n━ 6. 人の置き場所の上限と、起動時の片付け");
  process.env.SHARE_MODE = "lan";
  process.env.VISITOR_MAX = "2";
  const { runtimeFile } = await import("../lib/runtime");
  const [k1, k2, k3, k4] = [10, 11, 12, 13].map((i) => visitorKey(`visitor-${i}`)!);
  for (const k of [k1, k2, k3]) vs.withVisitor(k, () => runtimeFile("x.json"));
  const nowS = Date.now() / 1000;
  const age = (k: string, min: number) => fs.utimesSync(path.join(vs.visitorDir(k), ".last_used"), nowS - min * 60, nowS - min * 60);
  age(k1, 120);
  age(k2, 5);
  age(k3, 10);
  vs.withVisitor(k4, () => runtimeFile("x.json"));
  const keys = vs.listVisitors().map((v) => v.key);
  check("上限を超えたら、長く使われていない人（2時間前）は消す", !keys.includes(k1));
  check("直近（30分以内）に使った人の場所は、上限を超えても消さない", keys.includes(k2) && keys.includes(k3) && keys.includes(k4), `${keys.length}人`);
  check("「直近」の長さの既定は30分（VISITOR_KEEP_RECENT_MINUTES で変えられる）", vs.visitorRecentMs() === 30 * 60_000);
  delete process.env.VISITOR_MAX;
  // 起動時の片付け：人ごとの受信箱の「準備中」をエラーに直す
  const p2 = vs.withVisitor(k2, () => inbox.registerInbox({ text: "12月20日の勉強会で20分話せる方を探しています（人2）", source: "manual" }));
  const p3 = vs.withVisitor(k3, () => inbox.registerInbox({ text: "12月21日の勉強会で20分話せる方を探しています（人3）", source: "manual" }));
  age(k3, 20);
  const before3 = fs.statSync(path.join(vs.visitorDir(k3), ".last_used")).mtimeMs;
  const { startupCleanup } = await import("../instrumentation-node");
  startupCleanup();
  check("起動時の片付けで、人2の「準備中」がエラーになる", vs.withVisitor(k2, () => inbox.getInboxItem(p2.id)?.status) === "error");
  check("人3の「準備中」もエラーになる", vs.withVisitor(k3, () => inbox.getInboxItem(p3.id)?.status) === "error");
  check("片付けでは、人の場所の使った時刻を変えない（片付けが遅れない）", fs.statSync(path.join(vs.visitorDir(k3), ".last_used")).mtimeMs === before3);
  check("片付けで、人の印のない場所（no-person）を作らない", !fs.existsSync(vs.visitorDir("no-person")));
  delete process.env.SHARE_MODE;
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(failed ? `\n${failed}件 不合格` : "\nすべて合格");
    process.exit(failed ? 1 : 0);
  });
