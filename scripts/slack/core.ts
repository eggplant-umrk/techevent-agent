// Slack ボットの中身（Bolt に依存しない部分）。scripts/slack-bot.ts と scripts/slack/dry-run.ts から使う。
//
// 送信のルール：送ってよいのは「依頼スレッドへの受付の返信」と「SLACK_NOTIFY_CHANNEL（技術広報だけの非公開チャンネル）への通知」だけ。
// 候補の名前・理由・件数・見つからない理由は Slack のどこにも書かない（人選の検討は技術広報が画面で見る）。
// そのため Slack に出す文は下の決まった文（THREAD_TEXT・NOTIFY_TEXT）だけで、窓口の返り値から文を組み立てない。
// 投稿の API を呼ぶのは scripts/slack-bot.ts の replyInThread と notifyPrivate の2か所だけ（結合テストが判定する）。

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
}

/** 拾うのは「決まったチャンネルへの、人の、新しいトップレベルの投稿」だけ。理由も返す（ログ用）。 */
export function shouldHandle(e: MessageEventLike, cfg: Pick<BotConfig, "channel" | "botUserId">): { ok: true } | { ok: false; why: string } {
  if (e.channel !== cfg.channel) return { ok: false, why: "別のチャンネル" };
  if (e.subtype) return { ok: false, why: `subtype=${e.subtype}（編集・削除・参加・ボットの投稿など）` };
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

/** 1件の依頼を処理する：受け付けの返信 → 受信箱へ → 準備ができるまで確認 → 非公開チャンネルに通知 */
export async function handleRequest(e: Required<Pick<MessageEventLike, "channel" | "ts" | "user" | "text">>, slack: SlackLike, cfg: BotConfig) {
  if (e.channel !== cfg.channel) throw new Error("依頼のチャンネル以外の投稿は扱いません");

  await slack.replyInThread(e.ts, "received");

  const permalink = await slack.getPermalink({ channel: e.channel, message_ts: e.ts }).catch(() => null);
  let id: string;
  try {
    const res = await fetch(new URL("/api/inbox", cfg.inboxBaseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...shareHeaders() },
      body: JSON.stringify({ text: e.text, source: "slack", meta: { channel: e.channel, ts: e.ts, user: e.user, permalink } }),
    });
    if (!res.ok) throw new Error(`POST /api/inbox ${res.status}`);
    id = ((await res.json()) as { id: string }).id;
    if (!id) throw new Error("POST /api/inbox の返り値に id がない");
  } catch (err) {
    cfg.log(`受信箱に入れられませんでした（${err instanceof Error ? err.message : "不明"}）ts=${e.ts}`);
    await slack.replyInThread(e.ts, "failed");
    await slack.notifyPrivate("unreachable", permalink);
    return;
  }
  cfg.log(`受信箱に入れました id=${id} ts=${e.ts}`);

  let last: InboxItem | null = null;
  const until = Date.now() + cfg.pollTimeoutMs;
  while (Date.now() < until) {
    await sleep(cfg.pollIntervalMs);
    try {
      const res = await fetch(new URL(`/api/inbox/${encodeURIComponent(id)}`, cfg.inboxBaseUrl), { headers: shareHeaders() });
      if (!res.ok) continue; // 一時的な失敗は次の確認まで待つ
      last = (await res.json()) as InboxItem;
    } catch {
      continue;
    }
    if (last.status !== "processing") {
      cfg.log(`id=${id} は ${last.status}`);
      await slack.notifyPrivate(last.status === "ready" ? "ready" : "error", absoluteUrl(last.url, cfg.inboxBaseUrl));
      return;
    }
  }
  cfg.log(`id=${id} は時間切れ`);
  await slack.notifyPrivate("timeout", last ? absoluteUrl(last.url, cfg.inboxBaseUrl) : permalink);
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

/** 窓口を別の端末に見せる設定（SHARE_MODE=lan）のときは、合言葉をヘッダーで送る（値はログに出さない） */
function shareHeaders(): Record<string, string> {
  const code = (process.env.ACCESS_CODE ?? "").trim();
  return (process.env.SHARE_MODE ?? "").trim().toLowerCase() === "lan" && code ? { "X-Access-Code": code } : {};
}
