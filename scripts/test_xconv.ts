// X の会話の貼り付けと、主催者への返事のテスト（APIを使わない）。
//   npm run test:xconv
// - 会話の読み取りは偽物（scripts/fixtures/x_conversations.ts の raw）。確かめるのは本物のコード（lib/intake.ts）
// - 受信箱の流れ（読み取り → 既存の依頼の形 → 未定を注意点に）も、偽の runner で通す
// - 主催者への返事の検査（lib/organizerReply.ts）
// data/inbox.json には触らない（一時ファイルに書く）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, ProposalResult } from "../lib/agent";
import type { SpeakingRequest } from "../lib/data";
import { X_CONVERSATIONS } from "./fixtures/x_conversations";

const tmp = path.join(os.tmpdir(), `xconv-test-${Date.now()}.json`);
process.env.INBOX_FILE = tmp;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

async function main() {
  const intakeLib = await import("../lib/intake");
  const inbox = await import("../lib/inbox");
  const { resolveRequest } = await import("../lib/requests");
  const { isActiveInboxItem } = await import("../lib/archive");
  const { internalTerms } = await import("../lib/plainText");
  const { organizerReplyProblems, fallbackOrganizerReply } = await import("../lib/organizerReply");
  const { employees } = await import("../lib/data");
  const saved = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_after.json"), "utf-8")) as {
    rows: Array<{ request_id: string; result: ProposalResult }>;
  };
  const base = saved.rows.find((r) => r.request_id === "req004")!.result;

  // ---- 1. 読み取り後の検査（会話ごと）
  for (const c of X_CONVERSATIONS) {
    const { intake, nominee } = intakeLib.checkIntake(c.text, c.raw, c.received_at);
    const e = c.expected;
    const tag = `[${c.id} ${c.title}]`;
    check(`${tag} イベント名`, intake.event_name === e.event_name, String(intake.event_name));
    check(`${tag} 日程`, intake.date === e.date, `${intake.date}${intake.reasons.date ? `（${intake.reasons.date}）` : ""}`);
    check(`${tag} 形式`, intake.format === e.format, String(intake.format));
    check(`${tag} テーマ`, intake.theme === e.theme, String(intake.theme));
    check(`${tag} 主催者の名前`, intake.organizer === e.organizer, String(intake.organizer));
    check(`${tag} 指名（社員データで照合）`, nominee.employee_id === e.nominee_id, String(nominee.employee_id));
    check(`${tag} 未定の項目`, intake.undecided.join(",") === e.undecided.join(","), intake.undecided.join(",") || "なし");
    if (e.nominee_note_has) check(`${tag} 確かめられない指名は注意点に書く`, !!nominee.note?.includes(e.nominee_note_has), nominee.note ?? "");
    const note = intakeLib.undecidedNote(intake);
    check(`${tag} 未定があれば注意点の文になる（なければ出さない）`, e.undecided.length ? !!note && note.includes("未定") : note === null, note ?? "なし");
    check(`${tag} 注意点の文に内部の言葉がない`, internalTerms(note).length === 0 && internalTerms(nominee.note).length === 0);
  }

  // ---- 2. 日程の確かめ（細かいところ）
  const t = "開催は2027/1/29です。予備日は2/5";
  check("日程：引用が会話にあり1日なら決まり", intakeLib.checkDate(t, "開催は2027/1/29です", "2026-11-21").date === "2027-01-29");
  check("日程：引用が会話になければ未定", intakeLib.checkDate(t, "開催は2027/1/30です", "2026-11-21").date === null);
  check("日程：期間（1/27〜1/29）は未定", intakeLib.checkDate("1/27〜1/29のどこか", "1/27〜1/29のどこか", "2026-11-21").date === null);
  check("日程：「調整中」が付けば未定", intakeLib.checkDate("1/29で調整中です", "1/29で調整中です", "2026-11-21").date === null);
  check("日程：年がなく受信日より前の月日は翌年", intakeLib.checkDate("当日は1/29です", "当日は1/29です", "2026-11-21").date === "2027-01-29");
  check("日程：全角の数字でも読む", intakeLib.checkDate("開催は２０２７／１／２９", "開催は２０２７／１／２９", "2026-11-21").date === "2027-01-29");

  // ---- 3. 受信箱の流れ（手で追加 → 読み取り → 既存の依頼の形 → 未定を注意点に）
  for (const c of X_CONVERSATIONS) {
    const seen: { req: SpeakingRequest | null } = { req: null };
    const item = inbox.registerInbox({ text: c.text, source: "manual" });
    await inbox.prepare(
      item.id,
      async (request: SpeakingRequest, emit: (e: AgentEvent) => void) => {
        seen.req = request;
        emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
        return { ...base, request_id: request.id };
      },
      async () => c.raw,
    );
    const it = inbox.getInboxItem(item.id)!;
    const tag = `[${c.id}]`;
    check(`${tag} Agent には読み取った項目を先頭に足した依頼文が渡る（元の会話も続く）`, !!seen.req?.message.startsWith("【会話から読み取った項目") && seen.req.message.includes(c.text));
    check(`${tag} 指名は既存の依頼の形に入る`, (seen.req?.nominated_employee_id ?? null) === c.expected.nominee_id);
    for (const f of c.expected.undecided) {
      check(`${tag} 未定の「${intakeLib.INTAKE_LABEL[f as keyof typeof intakeLib.INTAKE_LABEL]}」は依頼文でも未定のまま`, !!seen.req?.message.match(new RegExp(`${intakeLib.INTAKE_LABEL[f as keyof typeof intakeLib.INTAKE_LABEL]}：未定`)));
    }
    if (c.expected.undecided.length) {
      check(`${tag} 未定は各候補の注意点に書く`, !!it.result && it.result.candidates.every((x) => x.cautions.some((s) => s.includes("未定") && s.includes("推測で埋めていません"))));
    } else {
      check(`${tag} 未定がなければ注意点を足さない`, !!it.result && it.result.candidates.every((x) => !x.cautions.some((s) => s.includes("推測で埋めていません"))));
    }
    const detail = inbox.detailView(it);
    check(`${tag} 画面の詳細に読み取った項目が出る`, detail.intake?.undecided.join(",") === c.expected.undecided.join(","));
    if (c.expected.event_name) check(`${tag} 一覧の見出しはイベント名`, detail.title === c.expected.event_name, detail.title);
    check(`${tag} 承認・下書きから同じ依頼（読み取った項目つき）を引ける`, resolveRequest({ request_id: item.id })?.intake?.organizer === c.expected.organizer);
  }
  const x2 = inbox.listInbox().find((x) => x.text === X_CONVERSATIONS[1].text)!;
  check("日程が未定の依頼は受信箱に残る（アーカイブに移さない）", isActiveInboxItem(x2));

  // ---- 4. 古い形の読み取り（名前だけ）も今までどおり
  const legacy = inbox.registerInbox({ text: "ぜひ笹倉さんにご登壇いただきたいです", source: "manual" });
  await inbox.prepare(legacy.id, async (r) => ({ ...base, request_id: r.id }), async () => "笹倉さん");
  const lg = inbox.getInboxItem(legacy.id)!;
  check("名前だけの読み取りは指名だけ（項目は読まない・依頼文は変えない）", lg.nominee?.employee_id === "e002" && !lg.intake && resolveRequest({ request_id: legacy.id })?.message === lg.text);

  // ---- 5. 主催者への返事の検査
  const all = employees();
  const name = "早乙女 蓮";
  const others = all.filter((e) => e.name !== name).map((e) => e.name);
  const good = "雲井さん、ご連絡ありがとうございます！「Tokyo LLM Ops 夜会」の件、弊社の早乙女がLLMの評価基盤のお話でお力になれそうです。いま本人に確認していますので、決まり次第あらためてご連絡します。";
  check("返事：社内の評価がなければ通る", organizerReplyProblems(good, name, others).length === 0, organizerReplyProblems(good, name, others).join(" / "));
  const bad = (s: string) => organizerReplyProblems(s, name, others);
  check("返事：忙しさを書いたら弾く", bad(good.replace("いま本人", "今は忙しさも落ち着いているので本人")).some((p) => p.includes("忙しさ")));
  check("返事：予定の埋まり具合を書いたら弾く", bad(good.replace("いま本人", "予定も空いているので本人")).some((p) => p.includes("予定")));
  check("返事：アンケートの反応を書いたら弾く", bad(good + "前回のアンケートでも反応が良かったです。").some((p) => p.includes("アンケート")));
  check("返事：登壇回数を書いたら弾く", bad(good.replace("弊社の早乙女が", "登壇2回の早乙女が")).some((p) => p.includes("登壇回数")));
  check("返事：ほかの候補との比較を書いたら弾く", bad(good.replace("弊社の早乙女が", "候補の中では弊社の早乙女が")).some((p) => p.includes("候補")));
  check("返事：ほかの社員の名前を書いたら弾く", bad(good.replace("お力になれそうです", "お力になれそうです（東雲さんとも相談します）")).some((p) => p.includes("東雲")));
  check("返事：社内の人に「さん」を付けたら弾く", bad(good.replace("弊社の早乙女が", "早乙女さんが")).some((p) => p.includes("敬称")));
  check("返事：進める人の名前がなければ弾く", bad("ご連絡ありがとうございます！社内で確認します。").some((p) => p.includes("名前")));
  check("返事：長すぎたら弾く", bad(good.repeat(3)).some((p) => p.includes("長すぎ")));
  check("返事：「候補日」は社内の判断ではないので通す", bad(good + "候補日を教えていただけると助かります。").length === 0);

  for (const c of X_CONVERSATIONS) {
    const { intake } = intakeLib.checkIntake(c.text, c.raw, c.received_at);
    for (const emp of all) {
      const fb = fallbackOrganizerReply({
        name: emp.name,
        theme: emp.expertise_tags.join("・"),
        organizer: intake.organizer,
        eventName: intake.event_name,
        undecided: intake.undecided.map((f) => intakeLib.INTAKE_LABEL[f]),
      });
      const ps = organizerReplyProblems(fb, emp.name, all.filter((e) => e.id !== emp.id).map((e) => e.name));
      if (ps.length) {
        check(`代わりの文が検査に通る（${c.id}・${emp.name}）`, false, ps.join(" / "));
      }
    }
  }
  check("代わりの文は全員×3件の会話で検査に通る", true);
  const fb2 = fallbackOrganizerReply({ name, theme: "LLM評価", organizer: "谷口", eventName: "フロントエンド広場", undecided: ["日程", "形式"] });
  check("代わりの文：未定の項目を教えてほしいと添える", fb2.includes("日程・形式が決まりましたら"), fb2);
  check("代わりの文：確約しない（本人に確認中）", fb2.includes("本人に確認"));

  fs.rmSync(tmp, { force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { force: true });
  process.exit(1);
});
