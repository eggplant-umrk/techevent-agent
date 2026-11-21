// Slack ボットの中身（Bolt に依存しない部分）。scripts/slack-bot.ts と scripts/slack/dry-run.ts から使う。
// 投稿してよいのは「依頼が来たチャンネルのスレッドへの返信」だけ。replyInThread 以外から投稿しない。

/** 窓口（①が作る app/api/inbox）の返り値。形は勝手に変えない。 */
export interface InboxItem {
  id: string;
  status: "processing" | "ready" | "error";
  summary?: {
    candidates: Array<{ name: string; confidence: "strong" | "conditional"; reason_short: string }>;
    no_fit?: { reasons: string[] };
  };
  url: string;
}

/** ボットが使う Slack の操作（Bolt の client のうち、この3つだけ）。 */
export interface SlackLike {
  postMessage(args: { channel: string; thread_ts: string; text: string; unfurl_links: boolean; unfurl_media: boolean }): Promise<unknown>;
  getPermalink(args: { channel: string; message_ts: string }): Promise<string | null>;
}

export interface BotConfig {
  /** 依頼を拾うチャンネルの id（SLACK_REQUEST_CHANNEL） */
  channel: string;
  /** ボット自身のユーザー id（auth.test で取得） */
  botUserId: string;
  /** 窓口のベースURL（既定 http://localhost:3000） */
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

/** Slack の mrkdwn で特別な意味を持つ文字を逃がす。 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function absoluteUrl(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return base;
  }
}

const link = (url: string, base: string) => `<${absoluteUrl(url, base)}|画面で詳しく見る>`;

/** 準備ができた・失敗した・時間切れ、のスレッドへの返信文。 */
export function formatResult(item: InboxItem | null, base: string, reason?: "timeout" | "unreachable"): string {
  if (reason === "unreachable") return "受信箱に入れられませんでした。窓口（npm run dev）が動いているか確認してから、もう一度投稿してください。";
  if (!item || reason === "timeout")
    return `5分たっても候補の準備が終わりませんでした。画面で状況を確認してください。${item ? `\n${link(item.url, base)}` : ""}`;
  if (item.status === "error") return `候補を準備できませんでした。画面で依頼を確認してください。\n${link(item.url, base)}`;

  const cands = item.summary?.candidates ?? [];
  const reasons = item.summary?.no_fit?.reasons ?? [];
  const lines: string[] = [];
  if (cands.length > 0) {
    lines.push(`候補が出ました（${cands.length}人）`);
    cands.forEach((c, i) => {
      const conf = c.confidence === "conditional" ? "条件付き" : "自信あり";
      lines.push(`${i + 1}. *${esc(c.name)}*（${conf}）${c.reason_short ? `：${esc(c.reason_short)}` : ""}`);
    });
    if (reasons.length > 0) {
      lines.push("", "ほかに見つからなかった理由");
      for (const r of reasons) lines.push(`• ${esc(r)}`);
    }
  } else {
    lines.push("合う候補が見つかりませんでした");
    for (const r of reasons) lines.push(`• ${esc(r)}`);
  }
  lines.push("", link(item.url, base));
  return lines.join("\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 1件の依頼を処理する：受け付け → 受信箱へ → 準備ができるまで確認 → 結果をスレッドへ。 */
export async function handleRequest(e: Required<Pick<MessageEventLike, "channel" | "ts" | "user" | "text">>, slack: SlackLike, cfg: BotConfig) {
  // 投稿先は常に「依頼が来たチャンネルの、その投稿のスレッド」に固定する
  const replyInThread = (text: string) => {
    if (e.channel !== cfg.channel) throw new Error("依頼のチャンネル以外には投稿しません");
    return slack.postMessage({ channel: e.channel, thread_ts: e.ts, text, unfurl_links: false, unfurl_media: false });
  };

  await replyInThread("受け付けました。候補を準備しています");

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
    await replyInThread(formatResult(null, cfg.inboxBaseUrl, "unreachable"));
    return;
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
      await replyInThread(formatResult(last, cfg.inboxBaseUrl));
      return;
    }
  }
  cfg.log(`id=${id} は時間切れ`);
  await replyInThread(formatResult(last, cfg.inboxBaseUrl, "timeout"));
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
