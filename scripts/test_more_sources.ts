// ブログと Slack の一部を材料に足す部分のテスト（APIは使わない・Slack に接続しない・data/ に書き込まない）。
//   npm run test:sources
import fs from "node:fs";
import path from "node:path";
import { fakeSlack, useTempFiles } from "./slack/sources-dry-run";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  delete process.env.MORE_SOURCES;
  const tmp = useTempFiles(); // Slack の保存先と対応表は一時ファイル
  const CARDS = path.join(process.cwd(), "data", "cards.json");
  const original = fs.readFileSync(CARDS);
  try {
    const { activities, published } = await import("../lib/data");
    const ms = await import("../lib/moreSources");
    const s = await import("./slack/sources");
    const { upsertCard, loadCards } = await import("../lib/cards");
    const { executeTool } = await import("../lib/tools");
    const { blogToLt } = await import("../lib/talkTag");
    const { internalTerms } = await import("../lib/plainText");

    // ---- ブログ
    const blogs = ms.blogPosts();
    const pubs = new Map(published().map((p) => [p.id, p]));
    check("ブログ8件は、既存の「メンバーのブログ」の記録と同じ記事（書き手・日付・タイトル・URL が一致）", blogs.length === 8 && blogs.every((b) => {
      const p = pubs.get(b.published_id);
      return !!p && p.genre === "メンバーのブログ" && p.author_id === b.author_id && p.title === b.title && p.url === b.url && p.published_at.startsWith(b.date);
    }));
    check("要約は3〜5文", blogs.every((b) => { const n = b.summary.split("。").filter(Boolean).length; return n >= 3 && n <= 5; }));
    const acts = activities();
    check("ブログは種類 blog の活動として入る", acts.filter((a) => a.type === "blog").length === 8);
    check("id は既存の活動とぶつからない", new Set(acts.map((a) => a.id)).size === acts.length);
    check("内部の言葉の判定が blg001・slk001 を見つける", internalTerms("blg001 と slk001").length >= 2);

    // ブログを根拠にしたカードは「ブログ済み」（同じ記事の発信の記録が付く）
    const out = upsertCard({
      card_id: null, employee_id: "e025", summary: "社内のアカウント管理を、人と端末の状態で判断する形に寄せた。", themes: ["退職時の権限の外し忘れをなくす仕組み"],
      evidence_activity_ids: ["blg005"], format: "lt", format_reason: "1つの判断に絞って話せる", published_ids: [], announcement_activity_ids: [],
    });
    check("ブログを根拠にすると、同じ記事の発信の記録が付き「ブログ済み」になる", out.ok && out.card!.published_ids.includes("pub031") && out.card!.publication_status === "blogged", out.errors.join(" / "));
    check("ブログ済みで未登壇のカードに「ブログをLTにできる」の印", blogToLt(out.card) === true && !blogToLt({ publication_status: "talked" }) && !blogToLt({ publication_status: "unpublished" }));
    const found = executeTool("search_cards", { query: "ゼロトラスト アカウント 権限" }).result as { results: Array<{ card_id: string; blog_to_lt?: string }> };
    check("search_cards で印が Agent に渡る", found.results.some((r) => r.card_id === out.card!.card_id && !!r.blog_to_lt));
    check("get_card でも印が渡る", !!(executeTool("get_card", { card_id: out.card!.card_id }).result as { blog_to_lt?: string }).blog_to_lt);
    fs.writeFileSync(CARDS, original); // 戻す
    check("カードのファイルは元に戻した", loadCards().every((c) => c.card_id !== out.card!.card_id));

    process.env.MORE_SOURCES = "off";
    check("MORE_SOURCES=off なら入れない（評価は今までどおりの材料）", activities().every((a) => a.type !== "blog" && a.type !== "slack"));
    delete process.env.MORE_SOURCES;

    // ---- 人の画面の「直近のブログ」と、架空の記事のページ
    const bv = await import("../lib/blogView");
    const mine = bv.blogsOf("e002");
    check("その人のブログを新しい順に（笹倉さんは2件）", mine.length === 2 && mine[0].date > mine[1].date, mine.map((b) => b.date).join(" > "));
    check("架空の記事はアプリの中の /blog/{id} に飛ぶ（新しいタブではない）", mine.every((b) => b.fictional && !b.external && b.href === `/blog/${b.id}`));
    check("要約が付く", mine.every((b) => !!b.summary));
    check("ブログがない人は0件（画面は「まだブログはありません」）", bv.blogsOf("e012").length === 0);
    check("本物の URL（example.com などでない）は外のページとして扱う", !bv.isFictionalUrl("https://bakuraku.jp/news/20261021/") && bv.isFictionalUrl("https://example.com/published/pub002"));
    const page = bv.fictionalBlogPost("blg008");
    check("記事のページは、架空の記事の本文（要約）・書き手・日付を返す", !!page && page.author === "笹倉 由紀" && page.date === "2026-10-10" && !!page.body);
    check("ない記事・本物の記事はページを出さない", bv.fictionalBlogPost("zzz") === null);
    const pd = (await import("../lib/people")).personDetail("e002");
    check("人の詳細（画面のデータ）に直近のブログが入る", pd?.blogs?.length === 2);

    // ---- Slack：落とす条件
    const users = { U_A: "e012" };
    check("ボットの投稿は落とす", s.skipReason({ ts: "1", user: "U_A", bot_id: "B1", text: "x".repeat(50) }, users) === "bot");
    check("ボット自身（ボットのユーザー id）の投稿も落とす", s.skipReason({ ts: "1", user: "U_BOTSELF", text: "x".repeat(50) }, { U_BOTSELF: "e012" }, "U_BOTSELF") === "bot");
    check("参加・編集などの通知は落とす", s.skipReason({ ts: "1", user: "U_A", subtype: "channel_join", text: "x".repeat(50) }, users) === "subtype");
    check("30字未満は落とす", s.skipReason({ ts: "1", user: "U_A", text: "了解です！ありがとうございます" }, users) === "short");
    check("スタンプだけ・メンションだけは落とす", s.skipReason({ ts: "1", user: "U_A", text: ":+1: :tada: <@U_B> :pray::pray::pray::pray:" }, users) === "short");
    check("対応表にいない人の投稿は読まない", s.skipReason({ ts: "1", user: "U_X", text: "x".repeat(50) }, users) === "unmapped");
    check("対応表にいる人の30字以上の投稿は読む", s.skipReason({ ts: "1", user: "U_A", text: "初期表示のLCPが中央値で1.8秒縮みました。依存の整理が効いています" }, users) === null);
    check("SLACK_SOURCE_CHANNELS がなければ読まない", s.sourceChannels("").channels.length === 0 && s.sourceChannels(undefined).channels.length === 0);
    check("形の違う id（DM の D… など）は使わない", JSON.stringify(s.sourceChannels("C123, D456,  G789 ,C9")) === JSON.stringify({ channels: ["C123", "C9"], invalid: ["D456", "G789"] }));

    // ---- Slack：決まった投稿で読む（dry-run と同じ偽の Slack）
    const slack = fakeSlack();
    const r = await s.readSlackSources(slack, { channels: ["C_SHARE", "C_PRIV", "D_DM"] });
    check("読むのは対応表にいる人の、落とす条件に当たらない投稿だけ（2件）", r.added.length === 2 && r.added.map((p) => p.employee_id).join(",") === "e012,e018", r.added.map((p) => p.employee_id).join(","));
    check("落とした理由と件数を数える", r.skipped.bot === 1 && r.skipped.short === 2 && r.skipped.unmapped === 1 && r.skipped.subtype === 1, JSON.stringify(r.skipped));
    check("非公開チャンネル・DM は読まない（中身を取りにいかない）", r.channels.filter((c) => c.status === "not_public").length === 2 && !slack.calls.includes("history:C_PRIV") && !slack.calls.includes("history:D_DM"));
    check("指定していないチャンネルは読まない", !slack.calls.some((c) => c.includes("C_OTHER")));
    check("保存は本文の先頭400字・permalink・日時・社員 id だけ（Slack のユーザー id は残さない）", r.added.every((p) => Object.keys(p).sort().join(",") === "employee_id,id,permalink,posted_at,text" && p.text.length <= 400) && !JSON.stringify(r.added).includes("U_"));
    check("スタンプ・メンションの記法は本文から除く", r.added.every((p) => !/:tada:|<@/.test(p.text)));
    check("対応表にいない人は、Slack のユーザー id と件数だけを知らせる（名前は取らない）", JSON.stringify(r.unmapped_users) === JSON.stringify({ U_STRANGER: 1 }));
    const again = await s.readSlackSources(slack, { channels: ["C_SHARE"] });
    check("もう一度読むと、前回以降の投稿だけ（0件）", again.added.length === 0);

    // 読んだ投稿は種類 slack の活動として入り、根拠から投稿（permalink）に飛べる
    const slackActs = activities().filter((a) => a.type === "slack");
    check("Slack の投稿は種類 slack の活動として入り、url は permalink", slackActs.length === 2 && slackActs.every((a) => a.url?.startsWith("https://example.slack.com/archives/C_SHARE/")));

    // デモ用の本人（e031）に対応づけた投稿：DEMO_PERSON が off なら活動に出さない（エラーにしない）、on なら本人の活動
    const postsFile = process.env.SLACK_POSTS_FILE!;
    const saved = JSON.parse(fs.readFileSync(postsFile, "utf-8"));
    fs.writeFileSync(postsFile, JSON.stringify([...saved, { id: "slk900", employee_id: "e031", posted_at: "2026-11-21T09:00:00.000Z", permalink: "https://example.slack.com/archives/C_SHARE/p900", text: "本人の投稿のテストです。".repeat(4) }]));
    process.env.DEMO_PERSON = "off";
    const off = activities();
    check("DEMO_PERSON が off なら、本人（e031）の投稿は活動に出さない（ほかの投稿はそのまま）", !off.some((a) => a.id === "slk900") && off.filter((a) => a.type === "slack").length === 2);
    check("off でも検索などはエラーにならない", (() => { try { executeTool("search_activities", { query: "本人の投稿" }); return true; } catch { return false; } })());
    process.env.DEMO_PERSON = "on";
    const { employees } = await import("../lib/data");
    const on = activities().find((a) => a.id === "slk900");
    check("DEMO_PERSON が on なら、本人の活動として出る（本人は社員にいる）", on?.author_id === "e031" && employees().some((e) => e.id === "e031"));
    delete process.env.DEMO_PERSON;
  } finally {
    fs.writeFileSync(CARDS, original);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
