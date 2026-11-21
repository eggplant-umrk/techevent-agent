// 受信箱のテスト（APIを使わない）。
//   npm run test:inbox
// 本物の Agent の代わりに、保存済みの結果（docs/eval_after.json）を返す偽の runner を使う。
// data/inbox.json には触らない（一時ファイルに書く）。
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

  // ---- 窓口の返す形
  const view = inbox.publicView(ready, "http://localhost:3000");
  const keys = Object.keys(view).sort().join(",");
  check("GET の形：id・status・summary・url", keys === "id,status,summary,url", keys);
  check("url は画面でその依頼を開くURL", view.url === `http://localhost:3000/?inbox=${added.id}`);
  const cands = view.summary!.candidates;
  check("候補ごとに name・confidence・reason_short", cands.length === req004.candidates.length && cands.every((c) => Object.keys(c).sort().join(",") === "confidence,name,reason_short"));
  check("no_fit は reasons だけ", !view.summary!.no_fit || Object.keys(view.summary!.no_fit).join(",") === "reasons");
  check("summary の文に内部の言葉がない", JSON.stringify(view.summary).length > 0 && [...cands.map((c) => c.reason_short), ...(view.summary!.no_fit?.reasons ?? [])].every((t) => internalTerms(t).length === 0));
  const processingView = inbox.publicView({ ...ready, status: "processing" }, "http://localhost:3000");
  check("準備中は summary を返さない", !("summary" in processingView));

  // ---- 内部の言葉が入っていたら summary に出さない
  const dirty = {
    ...ready,
    result: {
      ...req004,
      candidates: req004.candidates.map((c, i) => (i === 0 ? { ...c, reason: "百瀬さん（act088）は reviewed=false です。", theme: "初期表示の改善" } : c)),
      no_fit: { reasons: ["e017 は外しました", "ほかに根拠のある人はいません"], next_checks: [] },
    },
  };
  const dv = inbox.publicView(dirty, "http://localhost:3000").summary!;
  check("理由に内部の言葉があればテーマ案に置き換える", dv.candidates[0].reason_short === "初期表示の改善", dv.candidates[0].reason_short);
  check("見つからない理由は内部の言葉を含む文を落とす", dv.no_fit!.reasons.join("|") === "ほかに根拠のある人はいません", dv.no_fit!.reasons.join("|"));

  // ---- 失敗したらエラー
  const bad = inbox.addToInbox({ text: "失敗する依頼", source: "manual" }, async () => {
    throw new Error("テスト用の失敗");
  });
  await inbox.prepare(bad.id, async () => {
    throw new Error("テスト用の失敗");
  });
  const err = inbox.getInboxItem(bad.id)!;
  check("失敗したらエラー（理由を残す）", err.status === "error" && err.error === "テスト用の失敗");
  check("エラーは summary を返さない", !("summary" in inbox.publicView(err, "http://localhost:3000")));

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
  await inbox.prepare(
    failing.id,
    async (request, emit) => {
      emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
      return { ...req004, candidates: [], no_fit: null, request_id: request.id };
    },
    async () => {
      throw new Error("読み取り失敗");
    },
  );
  const f = inbox.getInboxItem(failing.id)!;
  check("読み取りに失敗したら指名なし、候補がいなければ見つからない理由に書く", f.nominee?.employee_id === null && !!f.result?.no_fit?.reasons.some((t) => t.includes("指名を読み取れなかった")));

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
