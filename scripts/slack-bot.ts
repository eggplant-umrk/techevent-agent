// Slack の依頼チャンネルを入口にするボット（npm run slack）。Socket Mode なので外部公開URLは不要。
// - 決まったチャンネルへの新しい投稿だけを拾い、受信箱（POST /api/inbox）に入れる
// - 依頼スレッドには「受け付けました。技術広報から連絡します」とだけ返す
// - 準備ができたら、SLACK_NOTIFY_CHANNEL（技術広報だけの非公開チャンネル）に「新しい依頼の候補が準備できました」と画面へのリンクだけを送る
// - 候補の名前・理由・件数・見つからない理由は Slack のどこにも書かない（人選の検討は技術広報が画面で見る）
// - 練習用ワークスペース専用。本物の会社の Slack では動かさない
// トークンは .env からこのプロセスにだけ読み込む。値は表示・ログ出力しない。
import { App, LogLevel, webApi } from "@slack/bolt";
import { readSlackSources, reportLines, sourceChannels } from "./slack/sources";
import { type BotConfig, handleRequest, makeSeen, type MessageEventLike, type NotifyKind, notifyText, presentInboxUrlProblem, shouldHandle, type SlackLike, THREAD_TEXT, type ThreadKind } from "./slack/core";

try {
  process.loadEnvFile(".env");
} catch {
  console.error(".env がありません。.env.example を見て、SLACK_BOT_TOKEN・SLACK_APP_TOKEN・SLACK_REQUEST_CHANNEL を書いてください。");
  process.exit(1);
}

function required(name: string, check: (v: string) => boolean, hint: string): string {
  const v = process.env[name]?.trim();
  if (!v) fail(`.env に ${name} がありません（${hint}）`);
  if (!check(v!)) fail(`.env の ${name} の形が違います（${hint}）`);
  return v!;
}
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const botToken = required("SLACK_BOT_TOKEN", (v) => v.startsWith("xoxb-"), "xoxb- で始まる Bot User OAuth Token");

// ---------------------------------------------------------------------------
// npm run slack:sources（= slack-bot.ts --read-sources）：ネタ帳の材料として、指定チャンネルの投稿を読むだけ（送信しない）。
// トークンはこのファイルだけで使う（CLAUDE.md）。読む・落とす・保存するの中身は scripts/slack/sources.ts
// ---------------------------------------------------------------------------
const READ_SOURCES = process.argv.includes("--read-sources");
async function readSourcesMain() {
  const { channels, invalid } = sourceChannels();
  if (invalid.length) console.error(`SLACK_SOURCE_CHANNELS の形が違うものは使いません：${invalid.join(", ")}（C で始まるチャンネル id）`);
  if (!channels.length) {
    console.log("SLACK_SOURCE_CHANNELS が設定されていないので、Slack は読みません");
    return;
  }
  const client = new webApi.WebClient(botToken);
  const auth = await client.auth.test();
  const allowed = process.env.SLACK_ALLOWED_TEAM_ID?.trim();
  if (allowed && auth.team_id !== allowed) fail(`接続先のワークスペース（${auth.team}）が SLACK_ALLOWED_TEAM_ID と違うため止めました`);
  console.log(`ワークスペース：${auth.team}（${auth.team_id}）／読むチャンネル ${channels.length}件`);
  // 権限の名前だけ（トークンは出さない）。読むには channels:read と channels:history が要る
  const scopes = (auth.response_metadata as { scopes?: string[] } | undefined)?.scopes ?? [];
  const lacking = ["channels:read", "channels:history"].filter((x) => !scopes.includes(x));
  console.log(`ボットの権限：${scopes.join(", ") || "（取得できませんでした）"}${lacking.length ? `／足りない権限：${lacking.join(", ")}` : ""}`);
  const r = await readSlackSources(client as never, { channels, botUserId: String(auth.user_id) });
  for (const l of reportLines(r)) console.log(l);
}
if (READ_SOURCES) {
  readSourcesMain().then(
    () => process.exit(0),
    (err) => fail(`Slack を読めませんでした：${err instanceof Error ? err.message : "不明なエラー"}`),
  );
}
const appToken = required("SLACK_APP_TOKEN", (v) => v.startsWith("xapp-"), "xapp- で始まる App-Level Token（connections:write）");
const requestChannel = required("SLACK_REQUEST_CHANNEL", (v) => /^[CG][A-Z0-9]+$/.test(v), "依頼を拾うチャンネルの id。C で始まる英数字");
/** 技術広報だけが入る非公開チャンネル。設定がなければ通知しない */
const notifyChannel = process.env.SLACK_NOTIFY_CHANNEL?.trim() || null;
if (notifyChannel && !/^[CG][A-Z0-9]+$/.test(notifyChannel)) fail(".env の SLACK_NOTIFY_CHANNEL の形が違います（技術広報だけの非公開チャンネルの id。C または G で始まる英数字）");
const allowedTeam = process.env.SLACK_ALLOWED_TEAM_ID?.trim() || null;
const inboxBaseUrl = process.env.INBOX_BASE_URL?.trim() || "http://127.0.0.1:3000";
// 発表用（この端末）にだけつなぐ。見せる用（合言葉を全員に公開する npm run start:share）には Slack をつながない
{
  const problem = presentInboxUrlProblem(inboxBaseUrl);
  if (problem) fail(problem);
}

const log = (line: string) => console.log(`[slack] ${new Date().toLocaleTimeString("ja-JP")} ${line}`);

const app = new App({ token: botToken, appToken, socketMode: true, logLevel: LogLevel.WARN });

async function main() {
  const auth = await app.client.auth.test();
  if (allowedTeam && auth.team_id !== allowedTeam) {
    fail(`接続先のワークスペース（${auth.team}）が SLACK_ALLOWED_TEAM_ID と違うため止めました。練習用ワークスペースのトークンか確認してください。`);
  }
  const cfg: BotConfig = {
    channel: requestChannel,
    botUserId: String(auth.user_id),
    inboxBaseUrl,
    pollIntervalMs: 5_000,
    pollTimeoutMs: 5 * 60_000,
    log,
  };

  // 投稿は次の2か所だけ。文は決まった文（THREAD_TEXT・NOTIFY_TEXT）だけで、候補の名前・理由は書かない
  /** 依頼チャンネル（固定）の、threadTs のスレッドへの受付の返信 */
  async function replyInThread(threadTs: string, kind: ThreadKind) {
    if (!threadTs) throw new Error("スレッドの指定がない投稿はしません");
    return app.client.chat.postMessage({ channel: requestChannel, thread_ts: threadTs, text: THREAD_TEXT[kind], unfurl_links: false, unfurl_media: false });
  }
  /** SLACK_NOTIFY_CHANNEL（固定・技術広報だけの非公開チャンネル）への通知。設定がなければ送らない */
  async function notifyPrivate(kind: NotifyKind, link: string | null) {
    if (!notifyChannel) return null;
    return app.client.chat.postMessage({ channel: notifyChannel, text: notifyText(kind, link), unfurl_links: false, unfurl_media: false });
  }
  const slack: SlackLike = {
    replyInThread,
    notifyPrivate,
    getPermalink: async (args) => (await app.client.chat.getPermalink(args)).permalink ?? null,
  };
  const firstTime = makeSeen();

  app.event("message", async ({ event }) => {
    const e = event as MessageEventLike;
    const verdict = shouldHandle(e, cfg);
    if (!verdict.ok) return;
    if (!firstTime(`${e.channel}:${e.ts}`)) return; // Socket Mode の再送
    log(`依頼を受け付けました ts=${e.ts}`);
    // 待ち時間が長いので、イベントの受け取りとは切り離して進める
    handleRequest({ channel: e.channel!, ts: e.ts!, user: e.user!, text: e.text! }, slack, cfg).catch((err) =>
      log(`処理に失敗しました ts=${e.ts}（${err instanceof Error ? err.message : "不明"}）`),
    );
  });

  await app.start();
  log(`起動しました。ワークスペース：${auth.team}（${auth.team_id}、練習用か確認してください）／依頼チャンネル：${requestChannel}／通知：${notifyChannel ?? "なし（SLACK_NOTIFY_CHANNEL 未設定）"}／窓口：${inboxBaseUrl}`);
}

process.on("SIGINT", async () => {
  await app.stop().catch(() => undefined);
  process.exit(0);
});

if (!READ_SOURCES) main().catch((err) => {
  // Slack のエラー本文にトークンは含まれないが、念のため message だけ出す
  fail(`起動できませんでした：${err instanceof Error ? err.message : "不明なエラー"}`);
});
