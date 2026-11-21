// Slack なしの動作確認（トークン不要）：npx tsx scripts/slack/dry-run.ts
// 仮の受信箱サーバーを立て、偽の Slack にイベントを流して、拾う・無視する投稿と、Slack に出す文を確かめる。
// 送ってよいのは「依頼スレッドへの受付の返信」と「非公開チャンネルへの通知（決まった文＋画面へのリンク）」だけ。
import { spawn } from "node:child_process";
import path from "node:path";
import { handleRequest, makeSeen, NOTIFY_TEXT, shouldHandle, THREAD_TEXT, type BotConfig, type MessageEventLike, type NotifyKind, notifyText, type SlackLike, type ThreadKind } from "./core";

const PORT = 3998;
const CH = "C0REQUESTS";
const NOTIFY = "G0PRIVATEPR";
const BOT = "U0BOT";
/** 候補の情報らしい言葉。Slack に出す文に入っていないことを確かめる */
const CANDIDATE_WORDS = ["織部", "百瀬", "早乙女", "東雲", "鷹野", "理由", "候補が出ました", "見つからない理由", "初登壇"];

// 本物の slack-bot.ts と同じく、投稿先のチャンネルは固定・文は決まった文だけ
const posts: Array<{ channel: string; thread_ts: string | null; text: string }> = [];
function fakeSlack(notifyChannel: string | null): SlackLike {
  return {
    replyInThread: async (threadTs: string, kind: ThreadKind) => {
      posts.push({ channel: CH, thread_ts: threadTs, text: THREAD_TEXT[kind] });
      return { ok: true };
    },
    notifyPrivate: async (kind: NotifyKind, link: string | null) => {
      if (!notifyChannel) return null;
      posts.push({ channel: notifyChannel, thread_ts: null, text: notifyText(kind, link) });
      return { ok: true };
    },
    getPermalink: async (a) => `https://example.slack.com/archives/${a.channel}/p${a.message_ts.replace(".", "")}`,
  };
}
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

    // ---- 流れ：受付の返信 → 受信箱 → 非公開チャンネルに通知
    const run = async (text: string, ts: string, notifyChannel: string | null = NOTIFY, c: BotConfig = cfg) => {
      posts.length = 0;
      await handleRequest({ channel: CH, ts, user: "U0PR", text }, fakeSlack(notifyChannel), c);
      return posts.slice();
    };
    const noCandidateInfo = (ps: typeof posts) => ps.every((p) => CANDIDATE_WORDS.every((w) => !p.text.includes(w)));

    let p = await run("12/17のLT会で話せる人を探しています", "200.1");
    check("依頼スレッドには受付の文だけを返す", p.filter((x) => x.channel === CH).length === 1 && p[0].text === "受け付けました。技術広報から連絡します" && p[0].thread_ts === "200.1");
    const n = p.find((x) => x.channel === NOTIFY);
    check("準備ができたら非公開チャンネルに通知", !!n && n.thread_ts === null && n.text.startsWith(NOTIFY_TEXT.ready), n?.text.split("\n")[0]);
    const id = n?.text.match(/inbox=([^|>]+)/)?.[1];
    check("通知は決まった文と画面へのリンクだけ", !!id && n?.text === `${NOTIFY_TEXT.ready}\n<http://127.0.0.1:${PORT}/?inbox=${id}|画面で見る>`);
    check("候補の名前・理由・件数を Slack のどこにも書かない", noCandidateInfo(p));
    check("投稿先は依頼チャンネルのスレッドと通知チャンネルだけ", p.every((x) => (x.channel === CH && x.thread_ts === "200.1") || (x.channel === NOTIFY && x.thread_ts === null)));

    p = await run("12/17のLT会で話せる人を探しています", "201.1", null);
    check("通知先の設定がなければ通知しない（返信は受付だけ）", p.length === 1 && p[0].text === THREAD_TEXT.received);

    p = await run("エラーになる依頼", "202.1");
    check("候補づくりの失敗も非公開チャンネルにだけ知らせる", p.length === 2 && p[1].channel === NOTIFY && p[1].text.startsWith(NOTIFY_TEXT.error) && noCandidateInfo(p));

    p = await run("遅い依頼", "203.1");
    check("時間切れも非公開チャンネルにだけ知らせる", p.length === 2 && p[1].channel === NOTIFY && p[1].text.startsWith(NOTIFY_TEXT.timeout));

    p = await run("窓口が止まっている", "204.1", NOTIFY, { ...cfg, inboxBaseUrl: "http://127.0.0.1:3997" });
    check(
      "窓口が止まっているときは、スレッドに受付できなかった旨、通知チャンネルに依頼の投稿へのリンク",
      p.length === 3 && p[1].text === THREAD_TEXT.failed && p[2].channel === NOTIFY && p[2].text.startsWith(NOTIFY_TEXT.unreachable) && p[2].text.includes("example.slack.com"),
    );

    let threw = false;
    posts.length = 0;
    await handleRequest({ channel: "C0OTHER", ts: "206.1", user: "U0PR", text: "別のチャンネル" }, fakeSlack(NOTIFY), cfg).catch(() => (threw = true));
    check("依頼チャンネル以外の投稿は処理しない", threw && posts.length === 0);

    check("Slack に出す文は決まった文だけ", [...Object.values(THREAD_TEXT), ...Object.values(NOTIFY_TEXT)].every((t) => !/\$\{|候補：|理由：/.test(t)));
  } finally {
    server.kill();
  }
  console.log(failed === 0 ? "\nすべて合格" : `\n${failed}件 不合格`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
