// Slack の一部を読む処理を、Slack に接続せずに決まった投稿で確かめる（npm run slack:sources:dry-run）。
// 書き込みは一時ファイルだけ（data/sources/ は変えない）。トークンは使わない。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SlackMessage, SlackReader } from "./sources";

/** 決まった投稿を返す偽の Slack。C_SHARE（公開）・C_PRIV（非公開）・D_DM（DM）・C_OTHER（指定外）を持つ */
export function fakeSlack(): SlackReader & { calls: string[] } {
  const calls: string[] = [];
  const ts = (n: number) => `${1795200000 + n}.000100`;
  const share: SlackMessage[] = [
    { ts: ts(1), user: "U_MOMOSE", text: "初期表示のLCPが中央値で1.8秒縮みました。依存の整理とコード分割が効いています :tada:" },
    { ts: ts(2), user: "U_MOMOSE", text: ":+1: :tada:" }, // スタンプだけ
    { ts: ts(3), user: "U_MOMOSE", text: "了解です！" }, // 短い
    { ts: ts(4), user: "U_BOT", bot_id: "B1", text: "デプロイが完了しました。本番環境に反映されています。確認をお願いします。" }, // ボット
    { ts: ts(5), user: "U_STRANGER", text: "対応表にいない人の投稿です。これは長さは十分ありますが読みません。" }, // 対応表にいない
    { ts: ts(6), user: "U_KUGA", subtype: "channel_join", text: "<@U_KUGA> がチャンネルに参加しました" }, // 通知
    { ts: ts(7), user: "U_KUGA", text: "<@U_MOMOSE> 手書き領収書のOCRで、傾き補正を前処理に入れたら読み取りの失敗が半分になりました。" + "詳しくは設計メモに書きます。".repeat(40) }, // 長い
  ];
  const priv: SlackMessage[] = [{ ts: ts(8), user: "U_MOMOSE", text: "非公開チャンネルの投稿なので、長くても読んではいけません。絶対に。" }];
  const other: SlackMessage[] = [{ ts: ts(9), user: "U_MOMOSE", text: "指定していないチャンネルの投稿なので、読んではいけません。絶対に。" }];
  const byChannel: Record<string, SlackMessage[]> = { C_SHARE: share, C_PRIV: priv, D_DM: priv, C_OTHER: other };
  return {
    calls,
    conversations: {
      async info({ channel }) {
        calls.push(`info:${channel}`);
        if (channel === "C_PRIV") return { channel: { is_channel: true, is_private: true } };
        if (channel === "D_DM") return { channel: { is_im: true } };
        return { channel: { is_channel: true, is_private: false } };
      },
      async history({ channel, oldest }) {
        calls.push(`history:${channel}`);
        return { messages: (byChannel[channel] ?? []).filter((m) => !oldest || Number(m.ts) > Number(oldest)), has_more: false };
      },
    },
    chat: {
      async getPermalink({ channel, message_ts }) {
        return { permalink: `https://example.slack.com/archives/${channel}/p${message_ts.replace(".", "")}` };
      },
    },
  };
}

/** 一時ファイルに向けてから読む */
export function useTempFiles(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slack-sources-"));
  process.env.SLACK_STATE_FILE = path.join(dir, "state.json");
  process.env.SLACK_POSTS_FILE = path.join(dir, "posts.json");
  process.env.SLACK_USERS_FILE = path.join(dir, "users.json");
  fs.writeFileSync(process.env.SLACK_USERS_FILE, JSON.stringify({ U_MOMOSE: "e012", U_KUGA: "e018" }));
  return dir;
}

async function main() {
  const dir = useTempFiles();
  const { readSlackSources, reportLines } = await import("./sources");
  const slack = fakeSlack();
  console.log("（Slack には接続していません。決まった投稿で確かめます）");
  console.log("指定：C_SHARE（公開）・C_PRIV（非公開）・D_DM（DM）。C_OTHER は指定していない");
  const r = await readSlackSources(slack, { channels: ["C_SHARE", "C_PRIV", "D_DM"] });
  for (const l of reportLines(r)) console.log(l);
  for (const p of r.added) console.log(`  ${p.id} ${p.employee_id} ${p.posted_at.slice(0, 16)} ${p.permalink}\n    ${p.text.slice(0, 60)}…（${p.text.length}字）`);
  const again = await readSlackSources(slack, { channels: ["C_SHARE"] });
  console.log(`もう一度読むと：${again.added.length}件（前回以降の投稿だけ）`);
  console.log(`C_OTHER を読んだか：${slack.calls.some((c) => c.includes("C_OTHER")) ? "読んだ（×）" : "読んでいない"}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

if (process.argv[1]?.includes("sources-dry-run")) void main();
