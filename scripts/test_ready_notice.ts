// 候補づくりが終わった依頼の知らせ（lib/readyNotice.ts）のテスト。API もファイルも使わない。
//   npm run test:readynotice   （npm test にも入る）
// - 一覧の前回と今回を比べて「準備中 → 終わった」依頼だけを知らせる。今開いている依頼・最初から終わっていた依頼は知らせない
// - 文は種類ごとの決まった文。タブの題名には、まだ開いていない準備済みの件数
import fs from "node:fs";
import path from "node:path";
import { addNotices, BASE_TITLE, finishedNotices, NOTICE_MAX, NOTICE_NAME_MAX, noticeFor, noticeName, pageTitle, statusMap, unopenedReadyCount, type NoticeSource } from "../lib/readyNotice";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

const item = (id: string, status: NoticeSource["status"], extra: Partial<NoticeSource> = {}): NoticeSource => ({ id, status, title: `イベント${id}`, is_new: false, no_fit: false, kind: "request", ...extra });

// ---- 1. 決まった文
check("候補ができた：「○○の候補を準備できました」", noticeFor(item("a", "ready", { title: "Backend Craft Night #12" }))?.text === "Backend Craft Night #12の候補を準備できました");
check("依頼ではなさそう：「○○は依頼ではなさそうです」", noticeFor(item("a", "ready", { title: "今日のランチ", kind: "not_request" }))?.text === "今日のランチは依頼ではなさそうです");
check("不適切：止めたことだけを伝え、原文（題名）は出さない", noticeFor(item("a", "ready", { title: "Dev Party", kind: "inappropriate" }))?.text === "貼った会話は止めました（不適切な内容のため）");
check("エラー：「○○の候補づくりに失敗しました」", noticeFor(item("a", "error", { title: "QA Sprint Talks" }))?.text === "QA Sprint Talksの候補づくりに失敗しました");
check("合う候補なし：候補ができたとは言わない", noticeFor(item("a", "ready", { title: "Mock Night", no_fit: true }))?.text === "Mock Nightの準備が終わりました（合う候補は見つかりませんでした）");
check("種類：ready・no_fit・not_request・stopped・error", ["ready", "no_fit", "not_request", "stopped", "error"].join() === [item("a", "ready"), item("a", "ready", { no_fit: true }), item("a", "ready", { kind: "not_request" }), item("a", "ready", { kind: "inappropriate" }), item("a", "error")].map((x) => noticeFor(x)?.kind).join());
check("準備中・まだ始めていない依頼には、知らせを作らない", noticeFor(item("a", "processing")) === null && noticeFor(item("a", "new")) === null);
check("依頼ではない・不適切は、候補なし（no_fit）より先に見る", noticeFor(item("a", "ready", { kind: "not_request", no_fit: true }))?.kind === "not_request");
const long = "とても長いイベント名".repeat(8);
check(`長い名前は ${NOTICE_NAME_MAX} 字で切る・改行は空白に・空なら「新しい依頼」`, noticeName(long).length === NOTICE_NAME_MAX && noticeName(long).endsWith("…") && noticeName("1行目\n2行目") === "1行目 2行目" && noticeName("  ") === "新しい依頼");

check("題名が本文の先頭のままなら、先頭の「…」の中だけを名前にする", noticeName("「Mock Night」運営です。12月18日（金）19時〜、LT10分で") === "Mock Night" && noticeFor(item("a", "ready", { title: "「Mock Night」運営です。12月18日", no_fit: true }))?.text === "Mock Nightの準備が終わりました（合う候補は見つかりませんでした）");
check("題名がかっこだけ・かっこで始まらないときは、そのまま", noticeName("「フロントエンド広場」") === "「フロントエンド広場」" && noticeName("運営の「高田」です") === "運営の「高田」です");

// ---- 2. 準備中 → 終わった、だけを知らせる
const prev = statusMap([item("a", "processing"), item("b", "processing"), item("c", "ready"), item("d", "processing")]);
const now = [item("a", "ready"), item("b", "processing"), item("c", "ready"), item("d", "error"), item("e", "ready")];
const got = finishedNotices(prev, now, null);
check("準備中だった a（準備済み）と d（エラー）だけを知らせる", got.map((n) => `${n.id}:${n.kind}`).join() === "a:ready,d:error", got.map((n) => `${n.id}:${n.kind}`).join());
check("まだ準備中の依頼（b）は知らせない", !got.some((n) => n.id === "b"));
check("前から終わっていた依頼（c）と、最初から終わった状態で現れた依頼（e）は知らせない", !got.some((n) => n.id === "c" || n.id === "e"));
check("今開いている依頼は知らせない", finishedNotices(prev, now, "a").map((n) => n.id).join() === "d");
check("最初の読み込み（前回が空）では、何も知らせない", finishedNotices(new Map(), now, null).length === 0);
check("同じ一覧をもう一度見ても、知らせは増えない（2回目は前回がもう終わっている）", finishedNotices(statusMap(now), now, null).length === 0);
check("一覧から消えた依頼（開催日が過ぎたなど）は知らせない", finishedNotices(prev, [item("b", "processing")], null).length === 0);

// ---- 3. 知らせを足す
const n = (id: string, text = id) => ({ id, kind: "ready" as const, text });
check("足すものがなければ、そのまま（同じ配列）", (() => { const cur = [n("a")]; return addNotices(cur, []) === cur; })());
check("同じ依頼の知らせは1つだけ（新しい文に置き換える）", addNotices([n("a", "古い"), n("b")], [n("a", "新しい")]).map((x) => `${x.id}:${x.text}`).join() === "b:b,a:新しい");
check(`同時に出すのは ${NOTICE_MAX} つまで（古いものから消す）`, addNotices([n("a"), n("b"), n("c")], [n("d")]).map((x) => x.id).join() === "b,c,d");

// ---- 4. タブの題名
const list = [item("a", "ready", { is_new: true }), item("b", "ready", { is_new: true }), item("c", "ready"), item("d", "processing", { is_new: true }), item("e", "error", { is_new: true })];
check("まだ開いていない準備済みの件数（準備中・エラー・開いたものは数えない）", unopenedReadyCount(list, null) === 2);
check("今開いている依頼は数えない", unopenedReadyCount(list, "a") === 1);
check("準備中に一度開いて、終わったあとまだ見ていない依頼も数える（貼ってすぐ別のタブに移ったとき）", unopenedReadyCount(list, null, ["c"]) === 3 && unopenedReadyCount(list, "c", ["c"]) === 2);
check("見ていない依頼がエラーで終わったときも数える。まだ準備中なら数えない", unopenedReadyCount(list, null, ["e"]) === 3 && unopenedReadyCount(list, null, ["d"]) === 2);
check("題名：0件は「ネタ帳Agent」、1件は「(1) ネタ帳Agent」、100件以上は「(99+)」", pageTitle(0) === "ネタ帳Agent" && pageTitle(1) === "(1) ネタ帳Agent" && pageTitle(120) === "(99+) ネタ帳Agent");
const layout = fs.readFileSync(path.join(process.cwd(), "app", "layout.tsx"), "utf8");
check("題名のもとは、app/layout.tsx の題名と同じ", layout.includes(`title: "${BASE_TITLE}"`));

// ---- 5. ブラウザの通知（許可を求めるもの）は使わない
const sources = ["lib/readyNotice.ts", "components/ReadyNotices.tsx", "app/page.tsx"].map((f) => fs.readFileSync(path.join(process.cwd(), f), "utf8"));
check("ブラウザの通知（Notification・許可の求め）を使っていない", sources.every((s) => !/new Notification\(|Notification\.requestPermission|serviceWorker|PushManager/.test(s)));
check("知らせは aria-live の領域に出し、「開く」と閉じるボタンがある", sources[1].includes('aria-live="polite"') && sources[1].includes("開く") && sources[1].includes('aria-label="知らせを閉じる"'));

console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
process.exit(failed ? 1 : 0);
