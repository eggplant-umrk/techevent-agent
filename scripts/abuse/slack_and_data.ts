import "../_isolate"; // 実行時のデータ・金額の記録は一時フォルダ
// いじわる試験（Slack の受け取りと、データの崩れ）。Slack には投げない・API は使わない・data/ には書かない。
//   npx tsx scripts/abuse/slack_and_data.ts
// 結果は JSON の行で出す（docs/abuse_test.md にまとめる）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleRequest, makeSeen, shouldHandle, type BotConfig, type MessageEventLike, type SlackLike } from "../slack/core";

const out = (test: string, v: Record<string, unknown>) => console.log(JSON.stringify({ test, ...v }));
const tryIt = <T>(fn: () => T): { ok: true; value: T } | { ok: false; error: string } => {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 120) };
  }
};

async function slack() {
  const CH = "C0REQUESTS";
  const cfg: BotConfig = { channel: CH, botUserId: "U0BOT", inboxBaseUrl: "http://127.0.0.1:3997", pollIntervalMs: 100, pollTimeoutMs: 500, log: () => undefined } as BotConfig;
  const base: MessageEventLike = { type: "message", channel: CH, user: "U0PR", text: "LT枠の相談です。12月18日にお願いできますか", ts: "100.1" };
  const cases: Array<[string, MessageEventLike]> = [
    ["ふつうの依頼", base],
    ["画像だけ（本文なし・file_share）", { ...base, text: "", subtype: "file_share", ts: "101.1" }],
    ["画像つきの依頼（本文あり・file_share）", { ...base, subtype: "file_share", ts: "101.2" }],
    ["URL だけ", { ...base, text: "<https://example.com/event/1>", ts: "102.1" }],
    ["空の投稿（空白だけ）", { ...base, text: "   ", ts: "103.1" }],
    ["スタンプだけ", { ...base, text: ":pray:", ts: "103.2" }],
    ["編集された投稿（message_changed）", { ...base, subtype: "message_changed", ts: "104.1" }],
    ["編集の印がある投稿", { ...base, edited: { user: "U0PR", ts: "104.5" }, ts: "104.2" }],
    ["削除された投稿（message_deleted）", { ...base, subtype: "message_deleted", ts: "105.1" }],
    ["スレッドの中の返信", { ...base, thread_ts: "100.1", ts: "106.1" }],
    ["スレッドの返信をチャンネルにも出す（thread_broadcast）", { ...base, subtype: "thread_broadcast", thread_ts: "100.1", ts: "106.2" }],
    ["ボットあての DM", { ...base, channel: "D0DIRECT", ts: "107.1" }],
    ["別のチャンネル", { ...base, channel: "C0RANDOM", ts: "107.2" }],
    ["ボット自身の投稿", { ...base, user: "U0BOT", ts: "108.1" }],
    ["ほかのボットの投稿", { ...base, bot_id: "B0OTHER", ts: "108.2" }],
    ["参加の通知（channel_join）", { ...base, subtype: "channel_join", ts: "109.1" }],
    ["許可していないワークスペースの投稿（team が別）", { ...base, ts: "110.1", ...({ team: "T0OTHER" } as object) }],
    ["4,000字を超える投稿", { ...base, text: "あ".repeat(4500), ts: "111.1" }],
  ];
  out("Slack：拾うか・無視するか", { results: cases.map(([name, e]) => { const v = shouldHandle(e, cfg); return `${name} → ${v.ok ? "拾う" : `無視（${v.why}）`}`; }) });

  // 同じ文の連投（ts が違う）と、同じ投稿の再送（ts が同じ）
  const seen = makeSeen();
  const same = [seen(`${CH}:200.1`), seen(`${CH}:200.1`), seen(`${CH}:200.2`)];
  out("Slack：同じ投稿の再送と、同じ文の連投", { 再送は1回だけ: same[0] && !same[1], 連投は別の依頼として拾う: same[2] });

  // 窓口が止まっているとき：受付の返信 → 入れられない → 失敗の返信と通知
  const posts: string[] = [];
  const fake: SlackLike = {
    replyInThread: async (ts, kind) => void posts.push(`スレッド ${ts}：${kind}`),
    notifyPrivate: async (kind, link) => void posts.push(`通知：${kind}${link ? "（リンクあり）" : ""}`),
    getPermalink: async () => "https://example.slack.com/archives/C0REQUESTS/p1001",
  };
  const r = await handleRequest({ channel: CH, ts: "300.1", user: "U0PR", text: base.text! }, fake, cfg).then(() => "終わった", (e) => `例外：${e instanceof Error ? e.message : e}`);
  out("Slack：窓口（受信箱）が止まっているとき", { result: r, posts });
  // 受付の返信そのものが失敗したとき（Slack の一時的なエラー）
  const posts2: string[] = [];
  const failing: SlackLike = { ...fake, replyInThread: async () => { throw new Error("slack: ratelimited"); }, notifyPrivate: async (k) => void posts2.push(`通知：${k}`) };
  const r2 = await handleRequest({ channel: CH, ts: "301.1", user: "U0PR", text: base.text! }, failing, cfg).then(() => "終わった", (e) => `例外：${e instanceof Error ? e.message : e}`);
  out("Slack：受付の返信が失敗したとき", { result: r2, posts: posts2, note: "例外なら、その依頼は受信箱に入らない" });
  // 4,000字を超える投稿は、窓口が断る（400）→ ボットはどう返すか：窓口の入力の検査で確かめる
  const { parseInboxInput } = await import("../../lib/inbox");
  out("Slack：4,000字を超える投稿を窓口に渡すと", { parse: parseInboxInput({ text: "あ".repeat(4500), source: "slack" }) });
}

async function data() {
  const RT = process.env.DATA_RUNTIME_DIR!;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "abuse-data-"));
  const files = {
    INBOX_FILE: path.join(tmp, "inbox.json"),
    SAMPLE_PROPOSALS_FILE: path.join(tmp, "sample_proposals.json"),
    DRAFTS_FILE: path.join(tmp, "drafts.json"),
    SURVEY_ANALYSIS_FILE: path.join(tmp, "survey_analysis.json"),
    TALK_RECORD_FILE: path.join(tmp, "talk_records.json"),
  };
  Object.assign(process.env, files);
  fs.mkdirSync(RT, { recursive: true });
  const cards = await import("../../lib/cards");
  const inbox = await import("../../lib/inbox");
  const board = await import("../../lib/board");
  const people = await import("../../lib/people");
  const usageLib = await import("../../lib/usage");
  const notebook = await import("../../lib/notebook");
  const tools = await import("../../lib/tools");
  const archive = await import("../../lib/archive");

  const targets: Array<[string, string, () => unknown]> = [
    ["カード（data/runtime/cards.json）", path.join(RT, "cards.json"), () => cards.loadCards().length],
    ["人の情報（data/runtime/people.json）", path.join(RT, "people.json"), () => people.peopleRows().length],
    ["ネタ帳の読んだ記録（notebook_progress.json）", path.join(RT, "notebook_progress.json"), () => notebook.pendingEmployees().length],
    ["ネタ帳の更新の状態（notebook_state.json）", path.join(RT, "notebook_state.json"), () => notebook.pendingEmployees().length],
    ["受信箱（data/inbox.json）", files.INBOX_FILE, () => board.boardList().length],
    ["サンプルの依頼の候補（sample_proposals.json）", files.SAMPLE_PROPOSALS_FILE, () => board.boardList().length],
    ["下書き（drafts.json）", files.DRAFTS_FILE, () => board.boardDetail("req001")?.id],
    ["金額の記録（usage.json）", process.env.USAGE_FILE!, () => usageLib.totalUsd()],
    ["登壇者の記録（talk_records.json）", files.TALK_RECORD_FILE, () => (tools.getCard({ card_id: "card-e013-01" }) as { card_id?: string }).card_id],
    ["アンケートの分析（survey_analysis.json）", files.SURVEY_ANALYSIS_FILE, () => archive.archiveRows().length],
  ];
  const variants: Array<[string, string | null]> = [
    ["ない", null],
    ["空（0バイト）", ""],
    ["壊れた JSON", '{"card_id": "card-e0'],
    ["形が違う（配列のはずが文字列）", '"oops"'],
  ];
  const rows: string[] = [];
  for (const [name, file, read] of targets) {
    const cells: string[] = [];
    for (const [vname, content] of variants) {
      fs.rmSync(file, { force: true });
      if (content !== null) fs.writeFileSync(file, content);
      const r = tryIt(read);
      cells.push(`${vname}：${r.ok ? "読める" : `落ちる（${r.error.slice(0, 60)}）`}`);
    }
    fs.rmSync(file, { force: true });
    rows.push(`${name} → ${cells.join("／")}`);
  }
  out("データ：実行時のファイルが、ない・空・壊れているとき", { rows });

  // 壊れた受信箱に、新しい依頼を足そうとしたとき
  fs.writeFileSync(files.INBOX_FILE, "{broken");
  out("データ：受信箱が壊れているときに依頼を足す", { result: tryIt(() => inbox.registerInbox({ text: "依頼です", source: "manual" }).id) });
  fs.rmSync(files.INBOX_FILE, { force: true });

  // カレンダー：0件・読めない
  const ics = await import("../../lib/ics");
  const busy = await import("../../lib/busyness");
  const from = new Date("2026-11-21T00:00:00+09:00");
  const to = new Date("2026-12-05T00:00:00+09:00");
  out("データ：カレンダー（iCal）が0件・読めないとき", {
    予定0件の_ics: tryIt(() => ics.parseIcs("BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n", from, to).length),
    空の文字: tryIt(() => ics.parseIcs("", from, to).length),
    HTML: tryIt(() => ics.parseIcs("<html><body>Sign in</body></html>", from, to).length),
    予定のない社員の忙しさ: tryIt(() => busy.busyText(busy.busynessFor("e999"))),
    架空の社員の忙しさ: tryIt(() => busy.busyText(busy.busynessFor("e012"))),
  });

  // ネタ帳が0件に近い状態：カードを全部「消した」重ねを書いて読む
  const all = cards.loadCards();
  fs.writeFileSync(path.join(RT, "cards.json"), JSON.stringify({ cards: [], deleted: all.map((c) => c.card_id) }));
  const zero = tryIt(() => cards.loadCards().length);
  out("データ：ネタ帳が0件のとき", {
    cards: zero,
    search_cards: tryIt(() => (tools.searchCards({ query: "LLM" }) as { total_hits: number }).total_hits),
    受信箱の一覧: tryIt(() => board.boardList().length),
    人の一覧: tryIt(() => people.peopleRows().length),
    note: "重ねの形（cards・deleted）は lib/runtime.ts の今の形に合わせた。合わなければ cards の数は元のまま",
  });
  fs.rmSync(path.join(RT, "cards.json"), { force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function main() {
  await slack();
  await data();
}
main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
