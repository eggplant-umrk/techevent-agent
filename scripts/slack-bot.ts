// Slack の依頼チャンネルを入口にするボット（npm run slack）。Socket Mode なので外部公開URLは不要。
// - 決まったチャンネルへの新しい投稿だけを拾い、受信箱（POST /api/inbox）に入れる
// - 準備ができたら、同じスレッドに候補と「画面で詳しく見る」リンクを返す
// - 投稿するのは、依頼が来たチャンネルのスレッドへの返信だけ（DM・候補者本人への送信はしない）
// - 練習用ワークスペース専用。本物の会社の Slack では動かさない
// トークンは .env からこのプロセスにだけ読み込む。値は表示・ログ出力しない。
import { App, LogLevel } from "@slack/bolt";
import { handleRequest, makeSeen, shouldHandle, type BotConfig, type MessageEventLike, type SlackLike } from "./slack/core";

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
const appToken = required("SLACK_APP_TOKEN", (v) => v.startsWith("xapp-"), "xapp- で始まる App-Level Token（connections:write）");
const requestChannel = required("SLACK_REQUEST_CHANNEL", (v) => /^[CG][A-Z0-9]+$/.test(v), "依頼を拾うチャンネルの id。C で始まる英数字");
const allowedTeam = process.env.SLACK_ALLOWED_TEAM_ID?.trim() || null;
const inboxBaseUrl = process.env.INBOX_BASE_URL?.trim() || "http://127.0.0.1:3000";

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

  /** 唯一の投稿：依頼チャンネル（固定）の、threadTs のスレッドへの返信。DM・別チャンネル・新しい投稿はしない。 */
  async function replyInThread(threadTs: string, text: string) {
    if (!threadTs) throw new Error("スレッドの指定がない投稿はしません");
    return app.client.chat.postMessage({ channel: requestChannel, thread_ts: threadTs, text, unfurl_links: false, unfurl_media: false });
  }
  const slack: SlackLike = {
    replyInThread,
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
  log(`起動しました。ワークスペース：${auth.team}（${auth.team_id}、練習用か確認してください）／チャンネル：${requestChannel}／窓口：${inboxBaseUrl}`);
}

process.on("SIGINT", async () => {
  await app.stop().catch(() => undefined);
  process.exit(0);
});

main().catch((err) => {
  // Slack のエラー本文にトークンは含まれないが、念のため message だけ出す
  fail(`起動できませんでした：${err instanceof Error ? err.message : "不明なエラー"}`);
});
