// いじわる試験（docs/abuse_test.md）の A・B と書き込みの直しのテスト（本物の API は使わない・data/ に書き込まない）。
//   npm run test:robust
// 見るもの：API の時間切れ（手元の偽の API が返事をしない）→ 依頼は「エラー」、同時実行の枠は返る、やり直さない／
//           起動時の片付け（準備中のまま残った依頼をエラーにする）／書き込みは一時ファイルから置き換える（書きかけを残さない）
import "./_isolate";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "robust-"));
process.env.INBOX_FILE = path.join(tmp, "inbox.json");

async function main() {
  // ---- 偽の API：受け取るだけで返事をしない（3299番ではなく、空いている番号）
  let hits = 0;
  const hanging: http.ServerResponse[] = [];
  const server = http.createServer((req, res) => {
    hits++;
    req.resume();
    hanging.push(res); // 返さない
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  process.env.ANTHROPIC_API_KEY = "test-not-a-real-key";
  process.env.API_TIMEOUT_MS = "600";

  try {
    // ---- 1. API の呼び出し1回に時間切れ
    const { getClient, ApiTimeoutError, apiTimeoutMs } = await import("../lib/anthropic");
    const t0 = Date.now();
    const err = await getClient()
      .messages.create({ model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "x" }] })
      .then(() => null, (e: unknown) => e);
    const took = Date.now() - t0;
    check("返事をしない API は、時間切れで止まる", err instanceof ApiTimeoutError, String(err));
    check("時間切れはやり直さない（1回で止まる・時間は設定どおり）", hits === 1 && took >= 550 && took < 2500, `呼び出し ${hits}回・${took}ms`);
    check("時間切れの文は使う人向け（生のエラーを出さない）", err instanceof Error && /AI の返事が1秒なかったので止めました/.test(err.message), err instanceof Error ? err.message : "");
    hits = 0;
    const errBeta = await getClient()
      .beta.messages.create({ model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "x" }] })
      .then(() => null, (e: unknown) => e);
    check("beta の呼び出しにも同じ時間切れが付く", errBeta instanceof ApiTimeoutError && hits === 1, `呼び出し ${hits}回`);
    const ac = new AbortController();
    const p = getClient()
      .messages.create({ model: "claude-haiku-5-5", max_tokens: 10, messages: [{ role: "user", content: "x" }] }, { signal: ac.signal })
      .then(() => null, (e: unknown) => e);
    ac.abort();
    const errAbort = await p;
    check("呼ぶ側が止めたときは、時間切れとは言わない", !!errAbort && !(errAbort instanceof ApiTimeoutError), String(errAbort));
    delete process.env.API_TIMEOUT_MS;
    check("時間切れの既定は90秒", apiTimeoutMs() === 90_000);
    process.env.API_TIMEOUT_MS = "600";

    // 受信箱の依頼：候補づくり（runAgent）の途中で時間切れ → 「エラー」、枠は返る
    const slots = await import("../lib/apiSlots");
    const inbox = await import("../lib/inbox");
    const { runAgent } = await import("../lib/agent");
    const release = slots.acquireApiSlot();
    check("枠を1件取る", !!release && slots.busyApiSlots() === 1);
    let settled = false;
    const item = inbox.addToInbox({ text: "12月15日の勉強会で、生成AIの活用について20分話せる方を探しています", source: "manual" }, (r, e) => runAgent(r, e), undefined, () => {
      settled = true;
      release!();
    });
    const deadline = Date.now() + 10_000;
    while (!settled && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const after = inbox.getInboxItem(item.id);
    check("時間切れになった依頼は「エラー」になる（準備中のまま固まらない）", after?.status === "error", `${after?.status}：${after?.error}`);
    check("エラーの理由は時間切れの文", /秒なかったので止めました/.test(after?.error ?? ""), after?.error ?? "");
    check("同時実行の枠は必ず返る", settled && slots.busyApiSlots() === 0, `使用中 ${slots.busyApiSlots()}`);

    // ---- 2. 起動時の片付け
    const now = new Date().toISOString();
    const base = { source: "manual", meta: null, text: "x", received_at: now, started_at: now, finished_at: null, error: null, opened_at: null, nominee: null, result: null, events: [], run_usd: 0 };
    fs.writeFileSync(
      process.env.INBOX_FILE!,
      JSON.stringify([
        { ...base, id: "inb-a", status: "processing", progress: { stage: "searching", label: "探しています" } },
        { ...base, id: "inb-b", status: "ready", finished_at: now, pitch_status: "pending" },
        { ...base, id: "inb-c", status: "ready", finished_at: now },
        { ...base, id: "inb-d", status: "error", finished_at: now, error: "前のエラー" },
      ]),
    );
    const before = fs.readFileSync(process.env.INBOX_FILE!, "utf-8");
    void before;
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("../instrumentation");
    await register(); // 1回目は起動のときと同じ入口から
    const { startupCleanup } = await import("../instrumentation-node");
    const got = Object.fromEntries(inbox.listInbox().map((x) => [x.id, x]));
    check("起動時：準備中のまま残った依頼は「エラー（途中で止まりました）」になる", got["inb-a"].status === "error" && /途中で止まりました/.test(got["inb-a"].error ?? "") && !got["inb-a"].progress, JSON.stringify(got["inb-a"].error));
    check("起動時：押し直せる（状態がエラーなので「もう一度探す」が押せる）", got["inb-a"].status !== "processing");
    check("起動時：作りかけの「代わりの人を推す文」は作れなかった扱い（候補はそのまま）", got["inb-b"].status === "ready" && got["inb-b"].pitch_status === "error");
    check("起動時：準備済み・エラーの依頼には触らない", got["inb-c"].status === "ready" && got["inb-d"].error === "前のエラー");
    check("起動時：もう一度呼んでも何も変えない", inbox.recoverInterrupted() === 0);
    process.env.NEXT_PHASE = "phase-production-build";
    fs.writeFileSync(process.env.INBOX_FILE!, JSON.stringify([{ ...base, id: "inb-e", status: "processing" }]));
    startupCleanup();
    check("ビルドのときは片付けない", inbox.getInboxItem("inb-e")?.status === "processing");
    delete process.env.NEXT_PHASE;
    fs.writeFileSync(process.env.INBOX_FILE!, "{壊れた");
    let threw = false;
    try {
      startupCleanup();
    } catch {
      threw = true;
    }
    check("片付けに失敗しても起動は止めない", !threw);
    fs.rmSync(process.env.INBOX_FILE!, { force: true });

    // ---- 4. 書き込みは一時ファイルから置き換える
    const { writeJsonAtomic } = await import("../lib/fileStore");
    const dir = path.join(tmp, "rt", "sub");
    const f = path.join(dir, "cards.json");
    writeJsonAtomic(f, { cards: [1], deleted: [] });
    writeJsonAtomic(f, { cards: [1, 2], deleted: [] });
    check("書き込み：フォルダを作って書き、上書きできる", JSON.parse(fs.readFileSync(f, "utf-8")).cards.length === 2);
    check("書き込み：一時ファイルを残さない", fs.readdirSync(dir).length === 1, fs.readdirSync(dir).join(","));
    const realWrite = fs.writeFileSync;
    (fs as { writeFileSync: unknown }).writeFileSync = (file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file).endsWith(".tmp")) {
        realWrite(file, "{書きかけ");
        throw new Error("書いている途中で止まった（試験）");
      }
      return (realWrite as (...a: unknown[]) => void)(file, ...rest);
    };
    let stopped = false;
    try {
      writeJsonAtomic(f, { cards: [9, 9, 9], deleted: [] });
    } catch {
      stopped = true;
    } finally {
      (fs as { writeFileSync: unknown }).writeFileSync = realWrite;
    }
    check("書き込み：途中で止まっても、前のファイルは壊れない", stopped && JSON.parse(fs.readFileSync(f, "utf-8")).cards.length === 2);
    check("書き込み：途中で止まったときも、書きかけの一時ファイルを残さない", fs.readdirSync(dir).length === 1, fs.readdirSync(dir).join(","));
    const runtime = await import("../lib/runtime");
    process.env.DATA_RUNTIME_DIR = path.join(tmp, "runtime2");
    runtime.writeReplaced("x.json", [1, 2, 3]);
    check("実行時のデータ（data/runtime/）の書き込みも同じ形", JSON.parse(fs.readFileSync(runtime.runtimeFile("x.json"), "utf-8")).length === 3 && fs.readdirSync(path.dirname(runtime.runtimeFile("x.json"))).length === 1);
    const src = ["runtime", "inbox", "board", "data", "people", "releaseNotes", "surveys", "demoPerson", "surveyCsv"].filter((n) =>
      /fs\.writeFileSync\(/.test(fs.readFileSync(path.join("lib", `${n}.ts`), "utf-8")),
    );
    check("保存するファイルの書き込みは、すべて一時ファイルから置き換える形（直接の上書きが残っていない）", src.length === 0, src.join(","));
  } finally {
    for (const r of hanging) r.destroy();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
