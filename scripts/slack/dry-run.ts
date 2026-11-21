// Slack なしの動作確認（トークン不要）：npx tsx scripts/slack/dry-run.ts
// 仮の受信箱サーバーを立て、偽の Slack にイベントを流して、拾う・無視する・スレッドへの返信内容を確かめる。
import { spawn } from "node:child_process";
import path from "node:path";
import { handleRequest, makeSeen, shouldHandle, type BotConfig, type MessageEventLike, type SlackLike } from "./core";

const PORT = 3998;
const CH = "C0REQUESTS";
const BOT = "U0BOT";

// 本物の slack-bot.ts と同じく、投稿先のチャンネルは依頼チャンネルに固定
const posts: Array<{ channel: string; thread_ts: string; text: string }> = [];
const slack: SlackLike = {
  replyInThread: async (threadTs, text) => {
    posts.push({ channel: CH, thread_ts: threadTs, text });
    return { ok: true };
  },
  getPermalink: async (a) => `https://example.slack.com/archives/${a.channel}/p${a.message_ts.replace(".", "")}`,
};
const cfg: BotConfig = {
  channel: CH,
  botUserId: BOT,
  inboxBaseUrl: `http://127.0.0.1:${PORT}`,
  pollIntervalMs: 300,
  pollTimeoutMs: 4000,
  log: () => undefined,
};

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

async function main() {
  const tsx = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const server = spawn(process.execPath, [tsx, "scripts/slack/mock-inbox.ts", String(PORT)], {
    env: { ...process.env, MOCK_READY_AFTER_MS: "1000" },
    stdio: "ignore",
  });
  try {
    for (let i = 0; i < 50; i++) {
      const up = await fetch(`http://127.0.0.1:${PORT}/api/inbox/x`).then(() => true, () => false);
      if (up) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // ---- 拾う・無視する
    const base: MessageEventLike = { type: "message", channel: CH, user: "U0PR", text: "LT枠の相談です", ts: "100.1" };
    const cases: Array<[string, MessageEventLike, boolean]> = [
      ["新しい投稿は拾う", base, true],
      ["別のチャンネルは無視", { ...base, channel: "C0OTHER" }, false],
      ["ボット自身の投稿は無視", { ...base, user: BOT }, false],
      ["ほかのボットの投稿は無視", { ...base, bot_id: "B1", subtype: "bot_message" }, false],
      ["スレッド内の返信は無視", { ...base, ts: "100.2", thread_ts: "100.1" }, false],
      ["編集（message_changed）は無視", { ...base, subtype: "message_changed" }, false],
      ["削除は無視", { ...base, subtype: "message_deleted" }, false],
      ["参加の通知は無視", { ...base, subtype: "channel_join" }, false],
      ["空の本文は無視", { ...base, text: "  " }, false],
    ];
    for (const [name, e, want] of cases) check(name, shouldHandle(e, cfg).ok === want);

    const first = makeSeen();
    check("同じ投稿の再送は1回だけ処理", first("C:1") === true && first("C:1") === false);

    // ---- 流れ：受け付け → 受信箱 → 結果をスレッドへ
    const run = async (text: string, ts: string) => {
      posts.length = 0;
      await handleRequest({ channel: CH, ts, user: "U0PR", text }, slack, cfg);
      return posts.slice();
    };

    let p = await run("12/17のLT会で話せる人を探しています", "200.1");
    check("最初に「受け付けました」をスレッドへ", p[0]?.text === "受け付けました。候補を準備しています" && p[0]?.thread_ts === "200.1");
    check("候補をスレッドへ返す", p.length === 2 && p[1].text.includes("候補が出ました（3人）") && p[1].text.includes("（条件付き）") && p[1].text.includes("（自信あり）"), p[1]?.text.split("\n")[0]);
    check("画面へのリンクが絶対URL", p[1]?.text.includes(`<http://127.0.0.1:${PORT}/?inbox=`) ?? false);
    check("投稿先はすべて依頼のチャンネルのスレッド", p.every((x) => x.channel === CH && x.thread_ts === "200.1"));

    p = await run("Rustの組み込みで見つからない依頼", "201.1");
    check("no_fit は見つからない理由を返す", p[1]?.text.startsWith("合う候補が見つかりませんでした") && p[1].text.includes("• "), p[1]?.text.split("\n")[0]);

    p = await run("エラーになる依頼", "202.1");
    check("error はその旨を返す", p[1]?.text.startsWith("候補を準備できませんでした") ?? false);

    p = await run("遅い依頼", "203.1");
    check("時間切れはその旨を返す", p[1]?.text.startsWith("5分たっても") ?? false);

    const down = { ...cfg, inboxBaseUrl: "http://127.0.0.1:3997" };
    posts.length = 0;
    await handleRequest({ channel: CH, ts: "204.1", user: "U0PR", text: "窓口が止まっている" }, slack, down);
    check("窓口が止まっているときはその旨を返す", posts[1]?.text.startsWith("受信箱に入れられませんでした") ?? false);

    posts.length = 0;
    await handleRequest({ channel: CH, ts: "205.1", user: "U0PR", text: "<script> & 名前" }, slack, cfg);
    check("返信は2件だけ（DMや別の投稿をしない）", posts.length === 2);

    let threw = false;
    await handleRequest({ channel: "C0OTHER", ts: "206.1", user: "U0PR", text: "別のチャンネル" }, slack, cfg).catch(() => (threw = true));
    check("依頼チャンネル以外の投稿は処理しない", threw);
  } finally {
    server.kill();
  }
  console.log(failed === 0 ? "\nすべて合格" : `\n${failed}件 不合格`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
