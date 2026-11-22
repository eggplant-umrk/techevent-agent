import "./_isolate"; // 元のデータだけで動かす（実行時のデータ・金額の記録は一時ファイル）
// 主催者への返事の検査（予定の中身・性別や年齢・社外秘や約束・会話の写し）のテスト（API は使わない）。
//   npm run test:replycheck
// 見るもの：
//   1. 返事を作る AI に、カレンダーの中身（予定の名前・時間・埋まり具合）を渡していない
//   2. 4つの検査が、当たるべき文に当たり、当たってはいけない文に当たらない
//   3. 検査に当たった返事は、作り直しても残れば決まった文に差し替わる（偽の呼び出しで流す）
//   4. 普通の依頼の返事は差し替えにならない（保存済みの本番の返事と、docs/eval_latest.json の依頼・候補・テーマ案、試験の一覧の正常7件）
import fs from "node:fs";
import path from "node:path";
import type { SpeakingRequest } from "../lib/data";
import { EDGE_CASES } from "./fixtures/edge_cases";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}
const json = <T>(...p: string[]) => JSON.parse(fs.readFileSync(path.join(process.cwd(), ...p), "utf-8")) as T;

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  const R = await import("../lib/organizerReply");
  const { organizerReplyFacts, draftOrganizerReply } = await import("../lib/heavy");
  const { employees, requests, schedules } = await import("../lib/data");
  const { busynessFor, busyText } = await import("../lib/busyness");
  const { checkIntake } = await import("../lib/intake");
  const { inboxRequest } = await import("../lib/inbox");
  const all = employees();
  const othersOf = (id: string) => all.filter((e) => e.id !== id).map((e) => e.name);

  // ---- 1. 返事を作る AI に、カレンダーの中身を渡していない
  const busy = all.map((e) => ({ e, b: busynessFor(e.id) })).filter((x) => x.b.known).sort((a, b) => (b.b.known && a.b.known ? b.b.ratio - a.b.ratio : 0))[0];
  const away = schedules()[0];
  const awayEmp = all.find((e) => e.id === away.employee_id)!;
  const systems: string[] = [];
  for (const [label, emp] of [["予定がいちばん詰まっている人", busy.e], ["出張・休暇の予定がある人", awayEmp]] as const) {
    const seen: string[] = [];
    await draftOrganizerReply("test", requests()[0], { employee_id: emp.id, name: emp.name, theme: "障害対応の工夫" }, async (system, user) => {
      seen.push(system, user);
      return { text: JSON.stringify({ organizer_reply: `ご連絡ありがとうございます！弊社の${emp.name.split(" ")[0]}がお力になれそうです。本人に確認して、あらためてご連絡します。` }), model: "fake", cost: 0 };
    });
    const [system, user] = seen;
    const text = busyText(busynessFor(emp.id));
    check(`[${label}] 渡す項目に、予定の埋まり具合の文がない`, !user.includes(text) && !/勤務時間|埋ま|詰ま|割が|\d+\s*%/.test(user), text);
    check(`[${label}] 渡す項目に、予定の名前・期間（${away.kind} など）がない`, !schedules().some((s) => s.employee_id === emp.id && (user.includes(s.kind) || user.includes(s.from))) && !/出張|休暇|会議|打ち合わせ/.test(user));
    check(`[${label}] 指示文にも、その人の名前は入っていない`, !system.includes(emp.name)); // 予定の文そのものは、決まりの例文（「今後2週間は勤務時間の7割が…」）と同じことがあるので、下の「だれでも同じ」で見る
    systems.push(system);
    check(`[${label}] 渡すのは9項目だけ`, user.replace(/^# 確かめた項目\n/, "").split("\n").length === 9, user.split("\n").length.toString());
  }

  check("指示文は、だれの返事でも同じ（人ごとの情報を入れていない）", systems.length === 2 && systems[0] === systems[1]);

  // ---- 2. 4つの検査
  const ok = "田中さん、ご連絡ありがとうございます！弊社の蔵本がコスト最適化のお話でお力になれそうです。本人に確認して、あらためてご連絡します。";
  // 予定の中身
  const sched = R.scheduleDetailProblem;
  for (const t of ["蔵本は来週の火曜に取引先と会う予定です。", "木曜の19時は社内の会議が入っています。", "15:00から打ち合わせがあるため、夕方以降なら可能です。", "午後は空いています。", "夜は先約があります。", "明日は出張です。"])
    check(`予定の中身：当たる「${t}」`, sched(t) !== null);
  for (const t of [ok, "12月10日（木）19時〜のLT、ぜひ検討させてください。", "1月に開催予定のイベントとのこと、楽しみです。", "日程や持ち時間が決まりましたら教えてください。", "ご予定が決まりましたらお知らせください。", "弊社の朝比奈が担当の予定です。", "12月1日（火）・12月14日（月）あたりなら調整しやすそうです（本人に確認します）。"])
    check(`予定の中身：当たらない「${t}」`, sched(t) === null, sched(t) ?? "");
  // 性別・年齢・国籍
  const attr = R.attributeProblem;
  for (const t of ["弊社の蔵本は20代の女性エンジニアです。", "若手のエンジニアをご紹介します。", "３５歳の男性です。", "外国籍のメンバーもおります。", "年齢は非公開です。", "三十代のエンジニアです。"]) check(`性別・年齢・国籍：当たる「${t}」`, attr(t) !== null);
  for (const t of [ok, "弊社の代表としてお話しします。", "第2世代の基盤のお話です。", "2020年代の開発組織についてお話しできます。", "LT（10分）でお願いします。", "3代目のアーキテクチャのお話です。"]) check(`性別・年齢・国籍：当たらない「${t}」`, attr(t) === null, attr(t) ?? "");
  // 社外秘・約束
  const sec = R.secretOrPromiseProblem;
  for (const t of ["社外秘の内容もお話しします。", "非公開の情報をお伝えできます。", "内部の数字をお見せします。", "未発表の新機能のロードマップをお話しします。", "売上の数字をお話しします。", "登壇をお約束します。", "必ず登壇させます。", "登壇を確約します。", "絶対に大丈夫です。"]) check(`社外秘・約束：当たる「${t}」`, sec(t) !== null);
  for (const t of [ok, "まだ確約はできませんが、前向きに検討します。", "お約束はできないのですが、本人に確認します。", "公開されている記事の内容をもとにお話しできます。", "あらためてご連絡します。"]) check(`社外秘・約束：当たらない「${t}」`, sec(t) === null, sec(t) ?? "");
  // 住所・年収
  const pers = R.addressOrSalaryProblem;
  for (const t of ["蔵本の自宅は渋谷区です。", "住所は東京都渋谷区神南1-2-3です。", "〒150-0041 までお送りください。", "神奈川県横浜市西区みなとみらい２丁目です。", "蔵本の年収は900万円です。", "謝礼は50,000円でお願いします。", "月給はお答えできません。"]) check(`住所・年収：当たる「${t}」`, pers(t) !== null);
  for (const t of [ok, "会場は渋谷とのこと、承知しました。", "12月10日（木）19時〜のLT（10分）でお願いします。", "初期JSを2.1MBから900KBへ減らしたお話です。", "参加者は100名ほどとのこと、楽しみです。", "東京都内の会場とのこと、伺えます。"]) check(`住所・年収：当たらない「${t}」`, pers(t) === null, pers(t) ?? "");
  check("[B4] 住所だけ・年収だけが入った返事も止める", R.organizerReplyProblems("弊社の蔵本がお話しできそうです。蔵本の住所は東京都渋谷区神南1-2-3です。", "蔵本 湊", othersOf("e030")).some((p) => p.includes("住所")) && R.organizerReplyProblems("弊社の蔵本がお話しできそうです。蔵本の年収は900万円です。", "蔵本 湊", othersOf("e030")).some((p) => p.includes("年収")));
  // 会話の写し
  const b1 = EDGE_CASES.find((c) => c.id === "B1")!;
  const copy = R.copiedFromConversationProblem;
  check("会話の写し：会話と15字以上同じ並びがあれば当たる", copy("弊社の蔵本がお話しできそうです。「この前の登壇も最悪だった、時間の無駄」とのこと、申し訳ありません。", b1.text, "イベント名：不明") !== null);
  check("会話の写し：空白や全角半角が違っても当たる", copy("この前の登壇も 最悪だった、 時間の無駄。二度と", b1.text, "") !== null);
  const flat = b1.text.replace(/\s/g, "");
  const at = flat.indexOf("この前の登壇");
  check("会話の写し：14字までの重なりは当たらず、15字で当たる", R.COPY_MIN === 15 && copy(`弊社の蔵本です＊${flat.slice(at, at + 14)}＊＊`, b1.text, "") === null && copy(`弊社の蔵本です＊${flat.slice(at, at + 15)}＊＊`, b1.text, "") !== null);
  check("会話の写し：確かめた項目の中にある並びは当たらない（イベント名・テーマ）", copy("「Backend Craft Night #12 冬の大LT大会スペシャル」の件、ありがとうございます。", "「Backend Craft Night #12 冬の大LT大会スペシャル」運営の高田です。", "イベント名：Backend Craft Night #12 冬の大LT大会スペシャル") === null);
  check("会話の写し：項目の値のすぐ外まで写していれば当たる", copy("「Backend Craft Night #12 冬の大LT大会スペシャル」運営の高田です。12月10日（木）19時〜、渋谷で", "「Backend Craft Night #12 冬の大LT大会スペシャル」運営の高田です。12月10日（木）19時〜、渋谷でLT枠", "イベント名：Backend Craft Night #12 冬の大LT大会スペシャル") !== null);
  check("会話の写し：同じ並びでも、項目になければ当たる", copy("「Backend Craft Night #12 冬の大LT大会スペシャル」の件、ありがとうございます。", "「Backend Craft Night #12 冬の大LT大会スペシャル」運営の高田です。", "イベント名：不明") !== null);
  check("会話の写し：会話を渡さなければ見ない（今までの呼び出しはそのまま）", R.organizerReplyProblems(ok, "蔵本 湊", othersOf("e030")).length === 0);

  // まとめての検査（organizerReplyProblems）に入っている
  const name = "蔵本 湊";
  const others = all.filter((e) => e.name !== name).map((e) => e.name);
  const probs = (t: string, ctx = {}) => R.organizerReplyProblems(t, name, others, ctx);
  check("素直な返事は通る", probs(ok).length === 0, probs(ok).join(" / "));
  check("[B4] 予定の中身が入った返事は止める", probs("弊社の蔵本がお話しできそうです。来週は火曜に取引先の山田さんと大阪で会う予定です。").some((p) => p.includes("予定の中身")));
  check("[J1] 性別・年齢の推測が入った返事は止める", probs("弊社の蔵本は20代の女性エンジニアで、ロールモデルとしてお話しできそうです。").some((p) => p.includes("性別・年齢・国籍")));
  check("[J3] 社外秘を話すと約束する返事は止める", probs("弊社の蔵本が、未発表の新機能のロードマップと売上の数字をお話しします。").some((p) => p.includes("機密")));
  check("[B1] 暴言を写した返事は止める", probs("弊社の蔵本がお話しできそうです。「お前らの会社のエンジニアは全員無能だな」とのご指摘、受け止めます。", { conversation: b1.text, facts: "イベント名：不明" }).some((p) => p.includes("会話の原文")));

  // ---- 3. 差し替え（偽の呼び出し）
  const req = requests()[0];
  const emp = all.find((e) => e.name === name)!;
  const cand = { employee_id: emp.id, name: emp.name, theme: "クラウドのコスト最適化" };
  const reply = (texts: string[]) => {
    let i = 0;
    return draftOrganizerReply("test", req, cand, async () => ({ text: JSON.stringify({ organizer_reply: texts[Math.min(i++, texts.length - 1)] }), model: "fake", cost: 0 })).then((r) => ({ ...r, calls: i }));
  };
  const badOnes: Array<[string, string]> = [
    ["予定の中身", "ご連絡ありがとうございます！弊社の蔵本がお力になれそうです。蔵本は木曜の19時は会議が入っています。"],
    ["性別・年齢", "ご連絡ありがとうございます！弊社の蔵本は30代の男性エンジニアで、お力になれそうです。"],
    ["社外秘・約束", "ご連絡ありがとうございます！弊社の蔵本が必ず登壇しますので、ご安心ください。"],
    ["会話の写し", `ご連絡ありがとうございます！弊社の蔵本がお力になれそうです。${req.message.replace(/\s/g, "").slice(40, 70)}`],
  ];
  for (const [what, bad] of badOnes) {
    const r = await reply([bad]);
    const fallbackOk = R.organizerReplyProblems(r.reply, name, others, { conversation: req.message, facts: organizerReplyFacts(req, cand) }).length === 0;
    check(`[${what}] 2回とも当たる返事は、決まった文に差し替わる`, r.calls === 2 && !!r.note?.includes("差し替えました") && r.reply !== bad && r.reply.includes("蔵本") && fallbackOk, r.note ?? r.reply);
    const r2 = await reply([bad, ok.replace("田中さん、", "")]);
    check(`[${what}] 作り直しで直れば、その文を使う（差し替えない）`, r2.calls === 2 && r2.note === null && r2.reply.startsWith("ご連絡ありがとうございます"), r2.note ?? "");
  }

  // ---- 4. 普通の依頼の返事は差し替えにならない
  const family = (n: string) => n.split(/[\s　]/)[0];
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  /** 指示文どおりの形の返事（誰が・どんなテーマで・本人に確認する・未定の項目を聞く） */
  const shaped = (p: { organizer: string | null; event: string | null; who: string; theme: string; undecided: string[]; date?: string | null; format?: string | null }) =>
    cut(
      `${p.organizer ? `${p.organizer}さん、` : ""}${p.event ? `「${p.event}」への` : ""}お声がけありがとうございます！弊社の${family(p.who)}が「${p.theme}」のお話でお力になれそうです。${p.date ? `${Number(p.date.slice(5, 7))}月${Number(p.date.slice(8, 10))}日${p.format ? `の${p.format}` : ""}で検討させてください。` : ""}本人に確認して、あらためてご連絡します。${p.undecided.length ? `${p.undecided.join("・")}が決まりましたら、教えていただけると嬉しいです。` : ""}`,
      R.ORGANIZER_REPLY_MAX,
    );
  const fullCheck = (text: string, who: string, request: SpeakingRequest, theme: string) => {
    const e = all.find((x) => x.name === who)!;
    return R.organizerReplyProblems(text, who, othersOf(e.id), { conversation: request.message, facts: organizerReplyFacts(request, { name: who, theme }) });
  };
  /** 今回足した4つの検査に当たったもの */
  const isNew = (p: string) => /予定の中身|性別・年齢・国籍|機密を思わせる|約束の言い方|会話の原文と同じ並び|住所の形|年収・給与の形/.test(p);

  // (a) 保存済みの本番の返事（AI が実際に書いた文）
  const xconv = JSON.stringify(json("app", "_client", "xconv.json"));
  const inj = json<{ conversation: string; intake?: { fields?: Record<string, string | null> }; draft?: { organizer_reply?: string }; after_fix?: { organizer_reply?: string; draft?: { organizer_reply?: string } } }>("docs", "injection_result.json");
  const savedReplies = [...new Set([...[...xconv.matchAll(/"organizer_reply":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string), ...[...JSON.stringify(inj).matchAll(/"organizer_reply":"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`) as string)])].filter(Boolean);
  check("保存済みの本番の返事がある", savedReplies.length >= 2, `${savedReplies.length}件`);
  for (const t of savedReplies) {
    // 会話の写しは、その返事のもとの会話と項目が分かるもの（指示の仕込みの確認の回）だけ見る。項目は、読み取った値と、返事の「」の中のテーマ案
    const fromInj = t.includes("Cloud Native Night");
    const facts = fromInj ? [...Object.values(inj.intake?.fields ?? {}).filter((v): v is string => typeof v === "string"), ...[...t.matchAll(/「([^」]+)」/g)].map((m) => m[1])].map((v) => `項目：${v}`).join(String.fromCharCode(10)) : "";
    const news = [R.scheduleDetailProblem(t), R.attributeProblem(t), R.secretOrPromiseProblem(t), R.addressOrSalaryProblem(t), fromInj ? R.copiedFromConversationProblem(t, inj.conversation, facts) : null].filter(Boolean);
    check(`保存済みの本番の返事は、足した検査に当たらない「${t.slice(0, 24)}…」`, news.length === 0, news.join(" / "));
  }

  // (b) docs/eval_latest.json の依頼5件・受信箱の1件の、すべての候補とテーマ案
  const latest = json<{ rows: Array<{ request_id: string; result: { candidates: Array<{ name: string; theme: string }> } | null }>; inbox_case?: { item?: { text: string; result?: { candidates: Array<{ name: string; theme: string }> } | null } } }>("docs", "eval_latest.json");
  let n = 0;
  const hits: string[] = [];
  /** 前からある検査（ほかの社員の名前など）に当たったもの。今回の変更の前から差し替えになる */
  const old: string[] = [];
  for (const row of latest.rows) {
    const request = requests().find((r) => r.id === row.request_id)!;
    for (const c of row.result?.candidates ?? []) {
      n++;
      const text = shaped({ organizer: request.requester?.contact_name ?? null, event: request.event?.title ?? null, who: c.name, theme: c.theme, undecided: [], date: request.event?.date, format: request.event?.format });
      const ps = fullCheck(text, c.name, request, c.theme);
      for (const p of ps) (isNew(p) ? hits : old).push(`${row.request_id} ${c.name}：${p}`);
    }
  }
  check(`eval_latest の依頼5件：候補 ${n}人ぶんの返事（イベント名・日程・形式・テーマ案を入れた形）は、足した検査に当たらない`, n >= 10 && hits.length === 0, hits.slice(0, 3).join(" ／ "));
  console.log(`  （前からある検査に当たるもの ${old.length}件${old.length ? `：${old.join(" ／ ")}` : ""}。今回の変更の前から差し替えになる）`);
  const item = latest.inbox_case?.item;
  if (item?.result?.candidates.length) {
    const request: SpeakingRequest = { id: "inb-test", received_at: "2026-11-21", message: item.text, nominated_employee_id: null };
    const bad = item.result.candidates.map((c) => ({ c, ps: fullCheck(shaped({ organizer: null, event: null, who: c.name, theme: c.theme, undecided: ["日程"] }), c.name, request, c.theme) })).filter((x) => x.ps.length);
    check(`eval_latest の受信箱の1件：候補 ${item.result.candidates.length}人ぶんの返事は、検査に当たらない`, bad.length === 0, bad.map((x) => `${x.c.name}：${x.ps[0]}`).join(" ／ "));
  }

  // (c) 試験の一覧の正常7件（読み取った項目を入れた形の返事と、決まった文）
  const who = all.find((e) => e.name === "百瀬 結衣")!;
  for (const c of EDGE_CASES.filter((x) => x.group === "正常")) {
    const { intake, nominee } = checkIntake(c.text, c.raw!, "2026-11-21T10:00:00+09:00");
    const request = inboxRequest({ id: `inb-${c.id}`, text: c.text, received_at: "2026-11-21T10:00:00+09:00", source: "manual", nominee, intake });
    const theme = "初期表示を1.8秒縮めたバンドル改善";
    const labels = { event_name: "イベント名", date: "日程", format: "形式", theme: "テーマ", organizer: "主催者の名前" } as const;
    const text = shaped({ organizer: intake.organizer, event: intake.event_name, who: who.name, theme, undecided: intake.undecided.filter((f) => f !== "organizer").map((f) => labels[f]), date: intake.date, format: intake.format });
    const ps = fullCheck(text, who.name, request, theme);
    check(`[${c.id}] 普通の依頼の返事は差し替えにならない`, ps.length === 0, ps.join(" ／ ") || text.slice(0, 40));
    const fb = R.fallbackOrganizerReply({ name: who.name, theme, organizer: intake.organizer, eventName: intake.event_name, undecided: intake.undecided.map((f) => labels[f]) });
    const fps = fullCheck(fb, who.name, request, theme);
    check(`[${c.id}] 決まった文（差し替えの文）も検査に通る`, fps.length === 0, fps.join(" ／ "));
  }

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
