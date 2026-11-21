// 代わりの人を推す文を「準備済み」のあとで作るテスト（APIは使わない。受信箱は一時ファイル）。
//   npm run test:pitch
import "./_isolate"; // 元のデータだけで動かす（実行時のデータ data/runtime/ は読まない・書かない）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, ProposalResult } from "../lib/agent";

const tmp = path.join(os.tmpdir(), `inbox-pitch-test-${process.pid}.json`);
process.env.INBOX_FILE = tmp;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

/** 外から終わらせられる Promise（代わりの人を推す文が「まだできていない」時間を作る） */
function gate<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function main() {
  const inbox = await import("../lib/inbox");
  const { pitchDeferred } = await import("../lib/agent");
  const saved = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_latest.json"), "utf-8")) as {
    rows: Array<{ request_id: string; result: ProposalResult }>;
  };
  // 指名の依頼（req004：笹倉さんを指名、代わりに百瀬さん）の保存結果から、推す文だけを外して使う
  const base = saved.rows.find((r) => r.request_id === "req004")!.result;
  const named: ProposalResult = { ...base, alternative_pitch: undefined };
  check("前提：保存結果に代わりの候補がいる", named.candidates.some((c) => c.is_alternative_to_nominee));

  // 指名を読み取る部分は固定（笹倉さん＝e002）
  const extractor = async () => "笹倉 由紀";
  const sawDeferred: boolean[] = [];
  const runner = async (request: { id: string }, emit: (e: AgentEvent) => void) => {
    sawDeferred.push(pitchDeferred());
    emit({ type: "final", result: { ...named, request_id: request.id } });
    emit({ type: "done", run_usd: 0.1, total_usd: 0, steps: 4 });
    return { ...named, request_id: request.id };
  };

  // ---- 準備済み → 裏で推す文 → できたら保存
  const g = gate<{ value: string; model: string; fellBack: boolean }>();
  const calls: Array<{ nominee: string | null | undefined; alts: string[] }> = [];
  const pitcher = async (_runId: string, request: { nominated_employee_id?: string | null }, _a: string | null, alts: Array<{ employee_id: string }>) => {
    calls.push({ nominee: request.nominated_employee_id, alts: alts.map((a) => a.employee_id) });
    return g.promise;
  };
  const item = inbox.registerInbox({ text: "Web Performance Night 2027 Winter で笹倉さんに登壇をお願いしたいです", source: "slack" });
  const done = inbox.prepare(item.id, runner, extractor, pitcher);
  for (let i = 0; i < 50 && inbox.getInboxItem(item.id)?.status !== "ready"; i++) await new Promise((r) => setTimeout(r, 10));
  const early = inbox.getInboxItem(item.id)!;
  check("Agent のループの中では推す文を作らない（runAgent に後回しが伝わる）", sawDeferred.length === 1 && sawDeferred[0] === true);
  check("候補ができた時点で「準備済み」になる（推す文を待たない）", early.status === "ready" && !!early.result);
  check("そのとき推す文は「作っている」で、まだない", early.pitch_status === "pending" && !early.result?.alternative_pitch);
  check("画面用の詳細にも「作っている」が出る", inbox.detailView(early).pitch_status === "pending");
  check("窓口（Slack が見る）は準備済みを返す", inbox.publicView(early, "http://127.0.0.1:3000").status === "ready");
  check("推す文は、指名された本人と代わりの候補で作る", calls.length === 1 && calls[0].nominee === "e002" && calls[0].alts.length > 0, JSON.stringify(calls[0]));

  g.resolve({ value: "百瀬さんは初期表示を1.8秒縮めた本人です。", model: "test", fellBack: false });
  await done;
  const after = inbox.getInboxItem(item.id)!;
  check("できたら保存し、「できた」にする", after.pitch_status === "ready" && after.result?.alternative_pitch === "百瀬さんは初期表示を1.8秒縮めた本人です。");
  check("作業ログに推す文を足す（画面の再現用）", after.events.some((e) => e.type === "alternative_pitch"));
  check("候補は変わらない", JSON.stringify(after.result?.candidates) === JSON.stringify(early.result?.candidates));

  // ---- 推す文を作れなくても、候補は準備済みのまま
  const item2 = inbox.registerInbox({ text: "Web Performance Night 2027 Winter で笹倉さんに登壇をお願いしたいです（2件目）", source: "manual" });
  await inbox.prepare(item2.id, runner, extractor, async () => {
    throw new Error("混み合っています");
  });
  const failedPitch = inbox.getInboxItem(item2.id)!;
  check("作れなかったら「作れなかった」、候補は準備済みのまま", failedPitch.status === "ready" && failedPitch.pitch_status === "error" && !!failedPitch.result);
  check("作れなかった理由を作業ログに残す", failedPitch.events.some((e) => e.type === "error" && e.message.includes("代わりの人を推す理由")));

  // ---- 指名のない依頼・代わりの候補がいない依頼は作らない
  let pitched = 0;
  const countPitcher = async () => {
    pitched++;
    return { value: "x", model: "test", fellBack: false };
  };
  const item3 = inbox.registerInbox({ text: "12月のLT会で話せる人を探しています", source: "slack" });
  await inbox.prepare(item3.id, runner, async () => null, countPitcher);
  const item4 = inbox.registerInbox({ text: "笹倉さんにお願いしたい（代わりなし）", source: "slack" });
  const noAltRunner = async (request: { id: string }, emit: (e: AgentEvent) => void) => {
    const r = { ...named, request_id: request.id, candidates: named.candidates.filter((c) => !c.is_alternative_to_nominee) };
    emit({ type: "done", run_usd: 0.1, total_usd: 0, steps: 3 });
    return r;
  };
  await inbox.prepare(item4.id, noAltRunner, extractor, countPitcher);
  check("指名のない依頼・代わりの候補がいない依頼では作らない（状態もなし）", pitched === 0 && !inbox.getInboxItem(item3.id)!.pitch_status && !inbox.getInboxItem(item4.id)!.pitch_status);

  // ---- 作っている途中で止まった（サーバーの再起動など）
  const items = JSON.parse(fs.readFileSync(tmp, "utf-8")) as Array<{ id: string; pitch_status?: string; finished_at: string }>;
  const stuck = items.find((x) => x.id === item.id)!;
  stuck.pitch_status = "pending";
  stuck.finished_at = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  fs.writeFileSync(tmp, JSON.stringify(items));
  check("「作っている」のまま5分を過ぎたら「作れなかった」として扱う", inbox.getInboxItem(item.id)?.pitch_status === "error");

  // ---- 受信箱の外（画面の「ネタ帳から候補を出す」など）は今までどおり
  check("受信箱の外では後回しにしない", pitchDeferred() === false);

  fs.rmSync(tmp, { force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  fs.rmSync(tmp, { force: true });
  console.error(e);
  process.exit(1);
});
