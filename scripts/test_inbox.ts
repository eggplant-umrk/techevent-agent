// 受信箱のテスト（APIを使わない）。
//   npm run test:inbox
// 本物の Agent の代わりに、保存済みの結果（docs/eval_after.json）を返す偽の runner を使う。
// data/inbox.json には触らない（一時ファイルに書く）。
import "./_isolate"; // 元のデータだけで動かす（実行時のデータ data/runtime/ は読まない・書かない）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, ProposalResult } from "../lib/agent";
import { isLocalRequest } from "../lib/localOnly";
import { internalTerms } from "../lib/plainText";

const tmp = path.join(os.tmpdir(), `inbox-test-${Date.now()}.json`);
process.env.INBOX_FILE = tmp;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

async function main() {
  // 環境変数を設定してから読み込む
  const inbox = await import("../lib/inbox");
  const { resolveRequest } = await import("../lib/requests");
  const saved = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_after.json"), "utf-8")) as {
    rows: Array<{ request_id: string; result: ProposalResult }>;
  };
  const req004 = saved.rows.find((r) => r.request_id === "req004")!.result;

  // ---- 入力の確かめ
  check("text が空なら弾く", !inbox.parseInboxInput({ text: " ", source: "slack" }).ok);
  check("source が不正なら弾く", !inbox.parseInboxInput({ text: "a", source: "mail" }).ok);
  check("meta が文字列以外なら弾く", !inbox.parseInboxInput({ text: "a", source: "slack", meta: { ts: 1 } }).ok);
  check("4000字を超えたら弾く", !inbox.parseInboxInput({ text: "あ".repeat(4001), source: "manual" }).ok);
  const good = inbox.parseInboxInput({ text: " 依頼本文 ", source: "slack", meta: { channel: "C1", ts: "1.2", user: "U1", permalink: "https://example.com/p" } });
  check("正しい入力は通る（前後の空白は落とす）", good.ok && good.input.text === "依頼本文");

  // ---- 受け取り → 準備中 → 準備済み
  const seen: { request: { id: string; message: string } | null } = { request: null };
  const runner = async (request: { id: string; message: string }, emit: (e: AgentEvent) => void) => {
    seen.request = request;
    emit({ type: "step", n: 1, max: 15 });
    emit({ type: "done", run_usd: 0.1, total_usd: 0, steps: 1 });
    return { ...req004, request_id: request.id };
  };
  const added = inbox.addToInbox({ text: "Web Performance Night で笹倉さんに登壇してほしい", source: "slack", meta: { permalink: "https://example.com/p" } }, runner);
  check("登録した直後は準備中", inbox.getInboxItem(added.id)?.status === "processing");
  check("id は inb- で始まる", added.id.startsWith("inb-"));
  await inbox.prepare(added.id, runner); // addToInbox が始めた処理とは別に、終わるまで待てる形で流す
  const ready = inbox.getInboxItem(added.id)!;
  check("候補づくりが終わると準備済み", ready.status === "ready");
  check("Agentには既存の依頼と同じ形で渡る", seen.request?.id === added.id && !!seen.request?.message.includes("笹倉"));
  check("作業ログを保存する", ready.events.length === 2 && ready.run_usd === 0.1);
  check("既存の流れ（承認・下書き・書き戻し）から同じ依頼を引ける", resolveRequest({ request_id: added.id })?.message === ready.text);

  // ---- 窓口の返す形（候補の名前・理由は返さない）
  const view = inbox.publicView(ready, "http://localhost:3000");
  const keys = Object.keys(view).sort().join(",");
  check("GET の形：id・status・url だけ", keys === "id,status,url", keys);
  check("url は画面でその依頼を開くURL", view.url === `http://localhost:3000/?inbox=${added.id}`);
  const dump = JSON.stringify(view);
  check("候補の名前・理由を返さない", req004.candidates.every((c) => !dump.includes(c.name) && !dump.includes(c.reason.slice(0, 10))));

  // ---- 失敗したらエラー
  const bad = inbox.addToInbox({ text: "失敗する依頼", source: "manual" }, async () => {
    throw new Error("テスト用の失敗");
  });
  await inbox.prepare(bad.id, async () => {
    throw new Error("テスト用の失敗");
  });
  const err = inbox.getInboxItem(bad.id)!;
  check("失敗したらエラー（理由を残す）", err.status === "error" && err.error === "テスト用の失敗");
  check("エラーでも id・status・url だけ", Object.keys(inbox.publicView(err, "http://localhost:3000")).sort().join(",") === "id,status,url");

  // ---- 指名の読み取り（読み取りは偽物、社員データとの照合は本物のコード）
  const { resolveNominee } = await import("../lib/nominee");
  check("フルネームで実在すれば指名あり", resolveNominee("笹倉 由紀").employee_id === "e002");
  check("姓＋さんでも1人に決まれば指名あり", resolveNominee("笹倉さん").employee_id === "e002");
  check("名前がなければ指名なし（注意点なし）", resolveNominee(null).employee_id === null && resolveNominee(null).note === null);
  const ghost = resolveNominee("山田さん");
  check("社員データにいなければ指名なし＋注意点", ghost.employee_id === null && !!ghost.note && ghost.note.includes("山田さん"), ghost.note ?? "");
  check("注意点の文に内部の言葉がない", internalTerms(ghost.note).length === 0);

  const seenNominee: { id: string | null | undefined } = { id: undefined };
  const named = inbox.addToInbox({ text: "ぜひ笹倉さんにご登壇いただきたいです", source: "manual" }, async () => null);
  await inbox.prepare(
    named.id,
    async (request, emit) => {
      seenNominee.id = request.nominated_employee_id;
      emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
      return { ...req004, request_id: request.id };
    },
    async () => "笹倉さん",
    async () => ({ value: "（テスト）", model: "test", fellBack: false }), // 代わりの人を推す文は API を使わずに作る
  );
  check("読み取った指名が既存の依頼の形に入って Agent に渡る", seenNominee.id === "e002", String(seenNominee.id));
  check("指名を受信箱に残す", inbox.getInboxItem(named.id)?.nominee?.employee_id === "e002");
  check("画面用の詳細に指名の名前が出る", inbox.detailView(inbox.getInboxItem(named.id)!).nominee_name === "笹倉 由紀");

  const unknown = inbox.addToInbox({ text: "ぜひ山田さんにご登壇いただきたいです", source: "manual" }, async () => null);
  await inbox.prepare(
    unknown.id,
    async (request, emit) => {
      seenNominee.id = request.nominated_employee_id;
      emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
      return { ...req004, request_id: request.id };
    },
    async () => "山田さん",
  );
  const u = inbox.getInboxItem(unknown.id)!;
  check("実在しない指名は指名なしで Agent に渡る", seenNominee.id === null);
  check("実在しない指名は各候補の注意点に書く", !!u.result && u.result.candidates.every((c) => c.cautions.some((t) => t.includes("山田さん"))));

  const failing = inbox.addToInbox({ text: "どなたか登壇できますか", source: "manual" }, async () => null);
  let failingRan = false;
  await inbox.prepare(
    failing.id,
    async (request, emit) => {
      failingRan = true;
      emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
      return { ...req004, candidates: [], no_fit: null, request_id: request.id };
    },
    async () => {
      throw new Error("読み取り失敗");
    },
  );
  const f = inbox.getInboxItem(failing.id)!;
  check("読み取りに失敗したらエラーとして止める（依頼として候補づくりを走らせない）", f.status === "error" && f.read_status === "failed" && !failingRan && f.result === null && !!f.error?.startsWith(inbox.READ_FAILED_ERROR));

  // ---- 一覧・開いた印
  const list = inbox.listInbox().map(inbox.listView);
  check("一覧は新しい順", list[0].id === failing.id && list.findIndex((x) => x.id === bad.id) < list.findIndex((x) => x.id === added.id));
  check("開くまでは「新しい」", list.every((x) => x.is_new));
  inbox.markOpened(added.id);
  check("開いたら「新しい」が外れる", inbox.listView(inbox.getInboxItem(added.id)!).is_new === false);

  // ---- localhost だけ
  const r = (headers: Record<string, string>) => new Request("http://localhost:3000/api/inbox", { headers });
  check("localhost は受け付ける", isLocalRequest(r({ host: "localhost:3000" })));
  check("127.0.0.1 は受け付ける", isLocalRequest(r({ host: "127.0.0.1:3000" })));
  check("[::1] は受け付ける", isLocalRequest(r({ host: "[::1]:3000" })));
  check("ほかのホスト名は断る", !isLocalRequest(r({ host: "100.82.52.98:3000" })));
  check("転送元が外なら断る", !isLocalRequest(r({ host: "localhost:3000", "x-forwarded-for": "203.0.113.5" })));

  fs.rmSync(tmp, { force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { force: true });
  process.exit(1);
});
