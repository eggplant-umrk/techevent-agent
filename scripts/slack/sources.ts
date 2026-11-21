// Slack の一部（指定チャンネルの投稿）を、ネタ帳の材料として読む。トークンは持たない（呼び出し側が読み取り用の client を渡す）。
//   - 読むのは .env の SLACK_SOURCE_CHANNELS に書いたチャンネルだけ。設定がなければ読まない
//   - 公開チャンネルだけ（非公開・DM・グループDMは読まない。チャンネルの情報で確かめる）
//   - 前回以降の投稿だけ（チャンネルごとに最後に読んだ ts を data/sources/slack_state.json に残す）
//   - コードで落とす：ボットの投稿、参加・編集などの通知（subtype つき）、スタンプやメンションを除くと短い投稿（30字未満）、
//     投稿した人が対応表（data/sources/slack_users.json：Slack のユーザー id → 社員 id）にいない投稿
//   - 保存するのは、本文の先頭400字・permalink・日時と、対応表で決めた社員 id だけ（Slack のユーザー id・名前・チャンネル名は保存しない）
// 送信はしない（読むだけ。conversations.info・conversations.history・chat.getPermalink）。
import fs from "node:fs";
import path from "node:path";
import type { SlackPost } from "../../lib/moreSources";

export const MIN_CHARS = 30;
export const MAX_SAVE_CHARS = 400;

/** 読むのに使う Slack の API（読み取りだけ） */
export interface SlackReader {
  conversations: {
    info(a: { channel: string }): Promise<{ channel?: { is_private?: boolean; is_im?: boolean; is_mpim?: boolean; is_channel?: boolean; is_archived?: boolean } }>;
    history(a: { channel: string; oldest?: string; limit?: number; cursor?: string }): Promise<{
      messages?: SlackMessage[];
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
    }>;
  };
  chat: { getPermalink(a: { channel: string; message_ts: string }): Promise<{ permalink?: string }> };
}

export interface SlackMessage {
  ts?: string;
  user?: string;
  bot_id?: string;
  app_id?: string;
  subtype?: string;
  text?: string;
}

export type SkipReason = "bot" | "subtype" | "short" | "unmapped";
export const SKIP_LABEL: Record<SkipReason, string> = {
  bot: "ボットの投稿",
  subtype: "参加・編集などの通知",
  short: `短い投稿（スタンプ・メンションを除いて${MIN_CHARS}字未満）`,
  unmapped: "対応表にいない人の投稿",
};

const DIR = () => path.join(process.cwd(), "data", "sources");
const STATE_FILE = () => process.env.SLACK_STATE_FILE || path.join(DIR(), "slack_state.json");
const USERS_FILE = () => process.env.SLACK_USERS_FILE || path.join(DIR(), "slack_users.json");
const POSTS_FILE = () => process.env.SLACK_POSTS_FILE || path.join(DIR(), "slack_posts.json");

const readJson = <T>(f: string, d: T): T => (fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf-8")) as T) : d);
const writeJson = (f: string, v: unknown) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n", "utf-8");
};

/** .env の SLACK_SOURCE_CHANNELS（カンマ区切りのチャンネル id）。形の違うものは使わない */
export function sourceChannels(raw = process.env.SLACK_SOURCE_CHANNELS): { channels: string[]; invalid: string[] } {
  const items = (raw ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return { channels: items.filter((c) => /^C[A-Z0-9]+$/.test(c)), invalid: items.filter((c) => !/^C[A-Z0-9]+$/.test(c)) };
}

/** スタンプ（:smile:）・メンション（<@U…>）・リンクの記法を除いた本文 */
export function plainText(text: string): string {
  return text
    .replace(/<@[A-Z0-9_]+(\|[^>]*)?>/g, "")
    .replace(/<!(here|channel|everyone)>/g, "")
    .replace(/<#[A-Z0-9]+\|?([^>]*)>/g, "$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/:[a-z0-9_+\-']+:/gi, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** 1件を読むかどうか（コードで決める）。読むなら null、落とすなら理由 */
export function skipReason(m: SlackMessage, users: Record<string, string>, botUserId?: string): SkipReason | null {
  if (m.bot_id || m.app_id || m.subtype === "bot_message" || (botUserId && m.user === botUserId)) return "bot";
  if (m.subtype) return "subtype";
  if (plainText(m.text ?? "").replace(/\s/g, "").length < MIN_CHARS) return "short";
  if (!m.user || !users[m.user]) return "unmapped";
  return null;
}

export interface ReadResult {
  added: SlackPost[];
  skipped: Record<SkipReason, number>;
  channels: Array<{ channel: string; read: number; status: "ok" | "not_public" | "error"; note?: string }>;
  /** 対応表にいない人の Slack ユーザー id と件数（対応表を作るための手がかり。名前は取らない） */
  unmapped_users: Record<string, number>;
}

/**
 * 指定チャンネルの、前回以降の投稿を読んで data/sources/slack_posts.json に足す。
 * reader は読み取り用の client（本物は scripts/slack-bot.ts --read-sources、確かめるときは決まった投稿を返す偽物）。
 */
export async function readSlackSources(reader: SlackReader, opts: { channels: string[]; botUserId?: string; now?: Date } ): Promise<ReadResult> {
  const users = readJson<Record<string, string>>(USERS_FILE(), {});
  const state = readJson<Record<string, string>>(STATE_FILE(), {});
  const posts = readJson<SlackPost[]>(POSTS_FILE(), []);
  const result: ReadResult = { added: [], skipped: { bot: 0, subtype: 0, short: 0, unmapped: 0 }, channels: [], unmapped_users: {} };
  let n = posts.reduce((m, p) => Math.max(m, Number(p.id.replace(/^slk/, "")) || 0), 0);
  const seen = new Set(posts.map((p) => p.permalink));

  for (const channel of opts.channels) {
    let step = "チャンネルの情報（conversations.info）";
    try {
      const info = (await reader.conversations.info({ channel })).channel;
      // 公開チャンネルだけ。非公開・DM・グループDM・アーカイブ済みは読まない
      if (!info || !info.is_channel || info.is_private || info.is_im || info.is_mpim || info.is_archived) {
        result.channels.push({ channel, read: 0, status: "not_public", note: "公開チャンネルではないので読みません" });
        continue;
      }
      const oldest = state[channel];
      const msgs: SlackMessage[] = [];
      let cursor: string | undefined;
      step = "投稿の読み取り（conversations.history）";
      for (let page = 0; page < 10; page++) {
        const res = await reader.conversations.history({ channel, oldest, limit: 200, cursor });
        msgs.push(...(res.messages ?? []));
        cursor = res.response_metadata?.next_cursor || undefined;
        if (!res.has_more || !cursor) break;
      }
      let latest = oldest ?? "0";
      let read = 0;
      for (const m of msgs.sort((a, b) => Number(a.ts) - Number(b.ts))) {
        if (!m.ts || (oldest && Number(m.ts) <= Number(oldest))) continue;
        if (Number(m.ts) > Number(latest)) latest = m.ts;
        const why = skipReason(m, users, opts.botUserId);
        if (why) {
          result.skipped[why]++;
          if (why === "unmapped" && m.user) result.unmapped_users[m.user] = (result.unmapped_users[m.user] ?? 0) + 1;
          continue;
        }
        step = "投稿のリンク（chat.getPermalink）";
        const permalink = (await reader.chat.getPermalink({ channel, message_ts: m.ts })).permalink;
        if (!permalink || seen.has(permalink)) continue;
        seen.add(permalink);
        const post: SlackPost = {
          id: `slk${String(++n).padStart(3, "0")}`,
          employee_id: users[m.user!],
          posted_at: new Date(Number(m.ts) * 1000).toISOString(),
          permalink,
          text: plainText(m.text ?? "").slice(0, MAX_SAVE_CHARS),
        };
        result.added.push(post);
        read++;
      }
      state[channel] = latest;
      result.channels.push({ channel, read, status: "ok" });
    } catch (e) {
      // エラーの内容だけ（トークンは出さない）。権限が足りないときは、どの呼び出しにどの権限が要るかを添える
      const msg = e instanceof Error ? e.message.replace(/xox[a-z]-[\w-]+/g, "（トークン）") : "不明なエラー";
      const data = (e as { data?: { needed?: string; error?: string } }).data;
      result.channels.push({ channel, read: 0, status: "error", note: `${step}で失敗：${msg}${data?.needed ? `（必要な権限：${data.needed}）` : ""}` });
    }
  }
  if (result.added.length) writeJson(POSTS_FILE(), [...posts, ...result.added]);
  writeJson(STATE_FILE(), state);
  return result;
}

export function reportLines(r: ReadResult): string[] {
  const lines = r.channels.map((c) => `  ${c.channel}：${c.status === "ok" ? `${c.read}件を読みました` : c.note}`);
  lines.push(`読んだ投稿 ${r.added.length}件／落とした投稿 ${Object.entries(r.skipped).map(([k, v]) => `${SKIP_LABEL[k as SkipReason]} ${v}`).join("・")}`);
  const um = Object.entries(r.unmapped_users);
  if (um.length) lines.push(`対応表にいない人：${um.map(([u, c]) => `${u}（${c}件）`).join("、")}（data/sources/slack_users.json に「Slack のユーザー id → 社員 id」を書くと次から読みます）`);
  return lines;
}
