// Slack ボットの中身（Bolt に依存しない部分）。scripts/slack-bot.ts と scripts/slack/dry-run.ts から使う。
//
// 送信のルール：送ってよいのは「依頼スレッドへの受付の返信」と「SLACK_NOTIFY_CHANNEL（技術広報だけの非公開チャンネル）への通知」だけ。
// 候補の名前・理由・件数・見つからない理由は Slack のどこにも書かない（人選の検討は技術広報が画面で見る）。
// そのため Slack に出す文は下の決まった文（THREAD_TEXT・NOTIFY_TEXT）だけで、窓口の返り値から文を組み立てない。
// 投稿の API を呼ぶのは scripts/slack-bot.ts の replyInThread と notifyPrivate の2か所だけ（結合テストが判定する）。
//
// 受け取りの関所（onMessage）：
// - 投稿ごとにワークスペース（team）が SLACK_ALLOWED_TEAM_ID と同じかを見る。違えば何も返さず無視する
// - 画像・ファイルつきの投稿（subtype=file_share）は、本文があれば本文だけを依頼として受け付ける（ファイルは読まない・渡さない）
// - URL だけ・スタンプだけなど依頼の文がない投稿は、受信箱に入れずに決まった文「依頼の文が見つかりませんでした」を返す
// - 同じ人から同じ文が10分以内に来たら、受信箱に足さずに決まった文「同じ依頼を受け付けています」を返す
import { hasRequestText } from "../../lib/requestText";

/** 窓口（app/api/inbox）の返り値。候補の名前・理由は返ってこない */
export interface InboxItem {
  id: string;
  status: "processing" | "ready" | "error";
  url: string;
}

/** 依頼スレッドへの返信（決まった文だけ） */
export const THREAD_TEXT = {
  received: "受け付けました。技術広報から連絡します",
  failed: "うまく受け付けられませんでした。お手数ですが、技術広報に直接ご連絡ください",
  no_request: "依頼の文が見つかりませんでした",
  duplicate: "同じ依頼を受け付けています",
} as const;
export type ThreadKind = keyof typeof THREAD_TEXT;

/** 非公開チャンネルへの通知（決まった文＋画面へのリンクだけ） */
export const NOTIFY_TEXT = {
  ready: "新しい依頼の候補が準備できました",
  error: "新しい依頼が届きましたが、候補を準備できませんでした",
  timeout: "新しい依頼が届きました（候補の準備に時間がかかっています）",
  unreachable: "新しい依頼が届きましたが、受信箱に入れられませんでした（窓口が止まっているかもしれません）",
} as const;
export type NotifyKind = keyof typeof NOTIFY_TEXT;

/** 通知の本文：決まった文と、リンクだけ（リンクは画面の依頼か、Slack の依頼の投稿） */
export function notifyText(kind: NotifyKind, link: string | null): string {
  const label = kind === "unreachable" ? "依頼の投稿を見る" : "画面で見る";
  return link ? `${NOTIFY_TEXT[kind]}\n<${link}|${label}>` : NOTIFY_TEXT[kind];
}

/** ボットが使う Slack の操作。投稿は決まった文しか渡せない形にしてある */
export interface SlackLike {
  /** 依頼チャンネル（固定）の threadTs のスレッドに、決まった文を返信する */
  replyInThread(threadTs: string, kind: ThreadKind): Promise<unknown>;
  /** SLACK_NOTIFY_CHANNEL（固定）に、決まった文とリンクを送る。設定がなければ何もしない */
  notifyPrivate(kind: NotifyKind, link: string | null): Promise<unknown>;
  getPermalink(args: { channel: string; message_ts: string }): Promise<string | null>;
}

export interface BotConfig {
  /** 依頼を拾うチャンネルの id（SLACK_REQUEST_CHANNEL） */
  channel: string;
  /** ボット自身のユーザー id（auth.test で取得） */
  botUserId: string;
  /** 受け付けるワークスペース（SLACK_ALLOWED_TEAM_ID）。決まっていれば、投稿ごとに team が同じかを見る */
  allowedTeam?: string | null;
  /** 窓口のベースURL（既定 http://127.0.0.1:3000。dev サーバーは 127.0.0.1 だけで待ち受け、Windows では localhost が ::1 に向くことがあるため） */
  inboxBaseUrl: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  log: (line: string) => void;
}

/** Slack から届く message イベントのうち、判定に使う項目だけ。 */
export interface MessageEventLike {
  type?: string;
  subtype?: string;
  channel?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  edited?: unknown;
  /** 投稿のワークスペース（イベントの team。なければ届いたイベント全体の team_id をボットが入れる） */
  team?: string;
  /** 添付ファイル。中身は読まない（本文があるかどうかだけを見る） */
  files?: unknown[];
}

/** 本文として拾ってよい subtype。ファイルつきの投稿は本文だけを使う */
const TEXT_SUBTYPES = new Set(["file_share"]);

/** 拾うのは「決まったチャンネルへの、人の、新しいトップレベルの投稿」だけ。理由も返す（ログ用）。 */
export function shouldHandle(e: MessageEventLike, cfg: Pick<BotConfig, "channel" | "botUserId" | "allowedTeam">): { ok: true } | { ok: false; why: string } {
  // ワークスペースは投稿ごとに見る（起動時の確認だけだと、共有チャンネルから別のワークスペースの投稿が届く）。team が分からないときも拾わない
  if (cfg.allowedTeam && e.team !== cfg.allowedTeam) return { ok: false, why: "許可していないワークスペース" };
  if (e.channel !== cfg.channel) return { ok: false, why: "別のチャンネル" };
  if (e.subtype && !TEXT_SUBTYPES.has(e.subtype)) return { ok: false, why: `subtype=${e.subtype}（編集・削除・参加・ボットの投稿など）` };
  if (e.bot_id || e.user === cfg.botUserId) return { ok: false, why: "ボットの投稿" };
  if (!e.user) return { ok: false, why: "投稿者がいない" };
  if (e.edited) return { ok: false, why: "編集" };
  if (e.thread_ts && e.thread_ts !== e.ts) return { ok: false, why: "スレッド内の返信" };
  if (!e.ts || !e.text?.trim()) return { ok: false, why: "本文が空" };
  return { ok: true };
}

export function absoluteUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return base;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 1件の依頼を処理する：受け付けの返信 → 受信箱へ → 準備ができるまで確認 → 非公開チャンネルに通知。受信箱に入れられたら true */
export async function handleRequest(e: Required<Pick<MessageEventLike, "channel" | "ts" | "user" | "text">>, slack: SlackLike, cfg: BotConfig): Promise<boolean> {
  if (e.channel !== cfg.channel) throw new Error("依頼のチャンネル以外の投稿は扱いません");

  await slack.replyInThread(e.ts, "received");

  const permalink = await slack.getPermalink({ channel: e.channel, message_ts: e.ts }).catch(() => null);
  let id: string;
  try {
    const res = await fetch(new URL("/api/inbox", cfg.inboxBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: e.text, source: "slack", meta: { channel: e.channel, ts: e.ts, user: e.user, permalink } }),
    });
    if (!res.ok) throw new Error(`POST /api/inbox ${res.status}`);
    id = ((await res.json()) as { id: string }).id;
    if (!id) throw new Error("POST /api/inbox の返り値に id がない");
  } catch (err) {
    cfg.log(`受信箱に入れられませんでした（${err instanceof Error ? err.message : "不明"}）ts=${e.ts}`);
    await slack.replyInThread(e.ts, "failed");
    await slack.notifyPrivate("unreachable", permalink);
    return false;
  }
  cfg.log(`受信箱に入れました id=${id} ts=${e.ts}`);

  let last: InboxItem | null = null;
  const until = Date.now() + cfg.pollTimeoutMs;
  while (Date.now() < until) {
    await sleep(cfg.pollIntervalMs);
    try {
      const res = await fetch(new URL(`/api/inbox/${encodeURIComponent(id)}`, cfg.inboxBaseUrl));
      if (!res.ok) continue; // 一時的な失敗は次の確認まで待つ
      last = (await res.json()) as InboxItem;
    } catch {
      continue;
    }
    if (last.status !== "processing") {
      cfg.log(`id=${id} は ${last.status}`);
      await slack.notifyPrivate(last.status === "ready" ? "ready" : "error", absoluteUrl(last.url, cfg.inboxBaseUrl));
      return true;
    }
  }
  cfg.log(`id=${id} は時間切れ`);
  await slack.notifyPrivate("timeout", last ? absoluteUrl(last.url, cfg.inboxBaseUrl) : permalink);
  return true;
}

/**
 * Slack の書き方（リンク・メンション・チャンネル <...>、スタンプ :pray:）を除いた本文。依頼の文があるかを見るためだけに使う
 * （受信箱に入れるのは元の本文）
 */
export function slackPlainText(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/:[a-z0-9_+'-]+:/gi, " ")
    .replace(/&(lt|gt|amp);/g, " ");
}

/** 同じ人・同じ文の連投とみなす間隔 */
export const DUPLICATE_WINDOW_MS = 10 * 60_000;

/**
 * 同じ人から同じ文が DUPLICATE_WINDOW_MS 以内に来たかの記録（ボットのメモリの中だけ）。
 * check：初めてなら true を返して記録する。forget：受信箱に入れられなかったときに記録を消す（投稿し直しを連投扱いにしない）
 */
export function makeRecent(windowMs = DUPLICATE_WINDOW_MS, limit = 500) {
  const last = new Map<string, number>();
  const keyOf = (user: string, text: string) => `${user}\n${text.normalize("NFKC").replace(/\s+/g, " ").trim()}`;
  return {
    check(user: string, text: string, now = Date.now()): boolean {
      const key = keyOf(user, text);
      const prev = last.get(key);
      if (prev !== undefined && now - prev < windowMs) return false;
      last.delete(key);
      last.set(key, now);
      if (last.size > limit) last.delete(last.keys().next().value as string);
      return true;
    },
    forget(user: string, text: string) {
      last.delete(keyOf(user, text));
    },
  };
}

/** 受け取った投稿をどうしたか（ログ・試験用。中身は書かない） */
export type MessageOutcome = "ignored" | "resent" | "no_request" | "duplicate" | "handled";

/**
 * 届いた投稿1件の受け取り（関所）。slack-bot.ts の message イベントから呼ぶ。
 * 返信は決まった文だけ。依頼の処理（受信箱へ）は handle に任せ、待たずに返す
 */
export function makeMessageHandler(
  slack: SlackLike,
  cfg: BotConfig,
  handle: (e: Required<Pick<MessageEventLike, "channel" | "ts" | "user" | "text">>, slack: SlackLike, cfg: BotConfig) => Promise<boolean> = handleRequest,
  now: () => number = Date.now,
) {
  const firstTime = makeSeen();
  const recent = makeRecent();
  return async (e: MessageEventLike): Promise<MessageOutcome> => {
    const verdict = shouldHandle(e, cfg);
    if (!verdict.ok) return "ignored";
    if (!firstTime(`${e.channel}:${e.ts}`)) return "resent"; // Socket Mode の再送
    const text = e.text!;
    if (!hasRequestText(slackPlainText(text))) {
      cfg.log(`依頼の文がない投稿でした ts=${e.ts}`);
      await slack.replyInThread(e.ts!, "no_request");
      return "no_request";
    }
    if (!recent.check(e.user!, text, now())) {
      cfg.log(`同じ人の同じ文の投稿でした（受信箱には足しません）ts=${e.ts}`);
      await slack.replyInThread(e.ts!, "duplicate");
      return "duplicate";
    }
    cfg.log(`依頼を受け付けました ts=${e.ts}`);
    // 待ち時間が長いので、イベントの受け取りとは切り離して進める
    handle({ channel: e.channel!, ts: e.ts!, user: e.user!, text }, slack, cfg).then(
      (accepted) => {
        if (!accepted) recent.forget(e.user!, text);
      },
      (err) => {
        recent.forget(e.user!, text);
        cfg.log(`処理に失敗しました ts=${e.ts}（${err instanceof Error ? err.message : "不明"}）`);
      },
    );
    return "handled";
  };
}

/** Socket Mode の再送で同じ投稿を2回処理しないための記録。 */
export function makeSeen(limit = 500) {
  const seen = new Set<string>();
  return (key: string) => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > limit) seen.delete(seen.values().next().value as string);
    return true;
  };
}

/**
 * ボットがつなぐ窓口は、発表用（この端末の 127.0.0.1:3000 など）だけ。見せる用（npm run start:share、合言葉を全員に公開する）には
 * Slack をつながない。問題があれば理由を返す（なければ null）
 */
export function presentInboxUrlProblem(url: string, sharePort = (process.env.SHARE_PORT ?? "").trim() || "3100"): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `INBOX_BASE_URL（${url}）の形が正しくありません`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "INBOX_BASE_URL は http:// か https:// で書いてください";
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return `INBOX_BASE_URL は発表用（この端末の 127.0.0.1）にしてください（今は ${u.hostname}）。見せる用には Slack をつなぎません`;
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  if (port === sharePort) return `INBOX_BASE_URL のポート ${port} は見せる用です。発表用（既定 3000）にしてください`;
  return null;
}
