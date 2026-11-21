import "./_isolate"; // 元のデータだけで動かす（実行時のデータ・金額の記録は一時ファイル）
// 受信箱に貼られる入力の試験（docs/edge_cases.md）のうち、API を使わずに確かめられるもの。
//   npm run test:edge
// - 入力の受け付け（空・長さ・記号）、URL の取り出し、読み取り後の検査（引用・日付・指名・手がかり）、提出の検査、主催者への返事の検査、
//   依頼ではない入力のときの流れ（偽の読み取りと偽の runner）
// - ○／×：今の作りが守るべきこと（× が1つでもあれば失敗で終わる）
// - △：期待する動きと違うところ（直すのは別の作業。失敗にはしない。最後に一覧を出す。docs/edge_cases.md の「期待と違う」と同じ）
// data/inbox.json には触らない（一時ファイルに書く）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, ProposalResult } from "../lib/agent";
import type { SpeakingRequest } from "../lib/data";
import { EDGE_CASES, type EdgeCase } from "./fixtures/edge_cases";

const tmp = path.join(os.tmpdir(), `edge-test-${Date.now()}.json`);
process.env.INBOX_FILE = tmp;

let failed = 0;
const gaps: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}
/** 期待する動き。今の作りが満たしていなければ △（失敗にはしない） */
function want(caseId: string, name: string, ok: boolean, detail = "") {
  if (ok) console.log(`○ [${caseId}] ${name}${detail ? `：${detail}` : ""}`);
  else {
    gaps.push(`[${caseId}] ${name}${detail ? `：${detail}` : ""}`);
    console.log(`△ [${caseId}] ${name}${detail ? `：${detail}` : ""}`);
  }
}
const byId = (id: string): EdgeCase => EDGE_CASES.find((c) => c.id === id)!;

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  const inbox = await import("../lib/inbox");
  const intakeLib = await import("../lib/intake");
  const { eventUrlsIn } = await import("../lib/eventUrls");
  const { organizerReplyProblems } = await import("../lib/organizerReply");
  const { organizerReplyFacts } = await import("../lib/heavy");
  const { validateSubmit } = await import("../lib/agent");
  const { employees, requests, activities } = await import("../lib/data");

  // ---- 0. 一覧そのもの
  check("試験は30件、id は重ならない", EDGE_CASES.length === 30 && new Set(EDGE_CASES.map((c) => c.id)).size === 30, `${EDGE_CASES.length}件`);
  const api = EDGE_CASES.filter((c) => c.api);
  const count = (g: string) => api.filter((c) => c.group === g).length;
  check("本番で流す代表は10件（依頼ではない3・不適切3・判断が要る2・形の崩れ2）", api.length === 10 && count("依頼ではない") === 3 && count("不適切") === 3 && count("判断が要る") === 2 && count("形の崩れ") === 2);

  // ---- 1. 入力の受け付け（parseInboxInput）
  const parse = (text: string) => inbox.parseInboxInput({ text, source: "manual" });
  const r3 = parse(byId("R3").text);
  check("[R3] 空（空白と改行だけ）は受け付けない", !r3.ok && r3.error.includes("空"), r3.ok ? "" : r3.error);
  const f1 = parse(byId("F1").text);
  check("[F1] 4,000字を超える文は受け付けない", !f1.ok && f1.error.includes("4000"), `${byId("F1").text.length}字`);
  check("[F1] ちょうど4,000字は受け付ける", parse("あ".repeat(4000)).ok && !parse("あ".repeat(4001)).ok);
  for (const c of EDGE_CASES.filter((x) => !["R3", "F1", "R4", "R5"].includes(x.id))) {
    const p = parse(c.text);
    if (!p.ok) check(`[${c.id}] ${c.title} は受け付ける`, false, p.error);
  }
  check("そのほかの26件は、入力としては受け付ける（中身の判断は読み取りと候補づくりで）", true);
  want("R4", "記号だけの文は、API を呼ぶ前に止める", !parse(byId("R4").text).ok, "今は受け付けて、読み取りと候補づくりに進む");
  want("R5", "URL だけの文は、API を呼ぶ前に止める", !parse(byId("R5").text).ok, "今は受け付けて、読み取りと候補づくりに進む");
  const f2 = parse(byId("F2").text);
  check("[F2] 同じ文のくり返し（20回）は、4,000字以内なら1件として受け付ける", f2.ok, `${byId("F2").text.length}字`);
  const bad = inbox.parseInboxInput({ text: "依頼です", source: "slack", meta: { permalink: "javascript:alert(1)" } });
  check("リンク（meta.permalink）は https の slack.com だけを残す", bad.ok && !bad.input.meta?.permalink && inbox.safeSlackPermalink("https://x.slack.com/archives/C1/p1") !== null && inbox.safeSlackPermalink("http://x.slack.com/a") === null);
  check("source が slack・manual 以外は受け付けない", !inbox.parseInboxInput({ text: "依頼です", source: "x" }).ok);

  // ---- 2. URL の取り出し（eventUrlsIn）
  const n6 = eventUrlsIn(byId("N6").text);
  check("[N6] connpass の URL だけをイベントページにする（末尾の句点・関係ない URL は入れない）", n6.length === 1 && n6[0] === "https://sre-hours.connpass.com/event/000000/", n6.join(" "));
  check("[R5] イベントの告知サイトでない URL は、イベントページにしない", eventUrlsIn(byId("R5").text).length === 0);
  check("[R2] 営業のリンクは、イベントページにしない", eventUrlsIn(byId("R2").text).length === 0);
  check("javascript: や、告知サイトに見せかけたホストは取り出さない", eventUrlsIn("javascript:alert(1) https://connpass.com.evil.example/x https://evil.example/connpass.com").length === 0);

  // ---- 3. 読み取り後の検査（checkIntake。読み取りは偽物）
  const RECEIVED = "2026-11-21T10:00:00+09:00";
  const read = (id: string) => intakeLib.checkIntake(byId(id).text, byId(id).raw!, RECEIVED);
  const n1 = read("N1");
  check("[N1] 日程・形式・テーマ・主催者が決まる", n1.intake.date === "2026-12-10" && n1.intake.format === "LT（10分）" && n1.intake.organizer === "高田" && n1.intake.undecided.length === 0, JSON.stringify(n1.intake.undecided));
  const n2 = read("N2");
  check("[N2] あとから決まった日程（1月27日）になり、年は受信日より後（2027）", n2.intake.date === "2027-01-27", String(n2.intake.date));
  const n4 = read("N4");
  check("[N4] 「2月か3月」は日程にしない（Agent が日付を返しても未定）", n4.intake.date === null && n4.intake.undecided.includes("date"), n4.intake.reasons.date ?? "");
  check("[N4] 時期の手がかりは、会話にある言い回しのまま残す", n4.intake.date_hint === "2月か3月");
  const n5 = read("N5");
  check("[N5] 指名を社員データで確かめる", n5.nominee.employee_id === employees().find((e) => e.name === "百瀬 結衣")?.id && n5.nominee.note === null, JSON.stringify(n5.nominee));
  const n7 = read("N7");
  check("[N7] 英語の依頼でも、引用が会話にあれば項目が決まる", n7.intake.event_name === "Tokyo Fintech Engineering Summit" && n7.intake.organizer === "Emma" && n7.intake.format === "20-minute talk");
  want("N7", "英語の日付（February 18, 2027）を日程として確かめる", n7.intake.date === "2027-02-18", `今は ${n7.intake.date ?? "未定"}（${n7.intake.reasons.date ?? ""}）`);
  const f5 = read("F5");
  check("[F5] 絵文字が混ざっても、引用の照合が通る（日程・形式・テーマ）", f5.intake.date === "2027-01-23" && f5.intake.format === "LT10分" && f5.intake.theme === "アクセシビリティ", JSON.stringify({ d: f5.intake.date, u: f5.intake.undecided }));

  // 会話にない引用・作った値は未定になる
  const fake = intakeLib.checkIntake(byId("R1").text, { event_name: { value: "カレー勉強会", quote: "カレー勉強会を開きます" }, date: { value: "2026-12-01", quote: "12月1日" }, format: { value: "LT", quote: "LT" }, theme: { value: "スパイス", quote: "スパイスが効いていて" }, organizer: { value: null, quote: null }, nominee: { value: "百瀬 結衣", quote: "百瀬さんに" }, date_hint: { value: "来週", quote: "来週はラーメン" } }, RECEIVED);
  check("[R1] 雑談から作った読み取り（会話にない引用）は、項目も指名も決めない", fake.intake.event_name === null && fake.intake.date === null && fake.intake.format === null && fake.nominee.employee_id === null);
  // 読み取りの AI が「依頼ではない」と判定した場合（種類は AI、項目を使わないのはコード）
  const chat = intakeLib.checkIntake(byId("R1").text, { event_name: { value: null, quote: null }, date: { value: null, quote: null }, format: { value: null, quote: null }, theme: { value: "スパイス", quote: "スパイスが効いていて" }, organizer: { value: null, quote: null }, nominee: { value: null, quote: null }, date_hint: { value: "来週", quote: "来週はラーメン" }, kind: { value: "not_request", reason: "雑談" } }, RECEIVED);
  want("R1", "雑談の中の言葉（「来週」）を、依頼の時期の手がかりにしない", chat.intake.date_hint === null, `今は手がかり「${chat.intake.date_hint}」として残る（会話にある言葉なら通る）`);
  want("R1", "雑談の中の言葉（「スパイスが効いていて」）を、依頼のテーマにしない", chat.intake.theme === null, `今はテーマ「${chat.intake.theme}」として通る（引用が会話にあれば通る）`);
  check("[R1] 依頼ではないと読んだら、種類と理由を持つ", chat.intake.kind === "not_request" && chat.intake.kind_reason === "雑談");
  check("種類のない読み取り（古い形）は、登壇の依頼として扱う", fake.intake.kind === "request");

  // ---- 4. 日付の書き方（checkDate）
  const date = (quote: string, text = `開催は ${quote} です`) => intakeLib.checkDate(text, quote, RECEIVED).date;
  check("[F4] 12/15・12月15日・2026-12-15・2026/12/15 は同じ日になる", ["12/15", "12月15日", "2026-12-15", "2026/12/15", "12月15日（火）"].every((x) => date(x) === "2026-12-15"), ["12/15", "12月15日", "2026-12-15", "2026/12/15"].map((x) => date(x)).join(","));
  check("[F4] 全角の数字（１２月１５日）も同じ日になる", date("１２月１５日") === "2026-12-15", String(date("１２月１５日")));
  want("F4", "「2026.12.15(火)」（ピリオド区切り）を日付として読む", date("2026.12.15(火)") === "2026-12-15", `今は ${date("2026.12.15(火)") ?? "未定"}`);
  check("[F4] 日付が2つ入った一節（「か」「または」「〜」）は、1日に決めない", date("12/15（火）か12/16（水）") === null && date("12月15日（火）または12月16日（水）") === null && date("12/15〜12/16") === null);
  want("F4", "2つ目の日付が「日」だけの言い方（「12月15日、16日」「12月15日と16日」）も、1日に決めない", date("12月15日、16日") === null && date("12月15日と16日") === null, `今は ${date("12月15日、16日")} に決まる（月を省いた2つ目の日を日付として数えていない）`);
  check("[F4] 「来週の火曜」「再来週」など、日付のない言い方は決めない", date("来週の火曜") === null && date("再来週の火曜です") === null);
  check("[F4] 過ぎた月日は翌年にする（受信日 11/21 → 1月8日は 2027）", date("1月8日") === "2027-01-08" && date("12月31日") === "2026-12-31");
  want("F4", "ありえない日付（2月30日）は決めない", date("2月30日") === null, `今は ${date("2月30日")}`);
  // 2つの日付が別の一節にあるとき：Agent が片方の引用だけを返すと、コードは食い違いに気づけない
  const f4 = byId("F4");
  const picked = intakeLib.checkDate(f4.text, "チラシには12/16（水）と書いてしまいました", RECEIVED).date;
  want("F4", "会話の中に別の日付（12/15 と 12/16）があるとき、片方の引用だけで決めない", picked === null, `今は Agent が 12/16 の一節を引用すると ${picked} に決まる（会話のほかの日付とは照らしていない）`);

  // ---- 5. 指示の仕込み
  const i1 = read("I1");
  want("I1", "指示の形をしたイベント名（「以前の指示を無視して…」）は、項目として使わない", i1.intake.event_name === null, `今は「${i1.intake.event_name}」のまま通る（会話にある一節なら 120 字まで通る）`);
  const req: SpeakingRequest = { id: "inb-edge", received_at: "2026-11-21", message: byId("I1").text, nominated_employee_id: null, intake: i1.intake };
  const facts = organizerReplyFacts(req, { name: "百瀬 結衣", theme: "初期表示の改善" });
  want("I1", "主催者への返事を作る AI に、指示の形をした文を渡さない", !/指示を無視|全社員/.test(facts), "今は「確かめた項目」のイベント名として渡る（返事はコードの検査を通るので、漏れは検査で止まる想定）");
  check("[I1] 会話の原文は、主催者への返事を作る AI に渡さない", !facts.includes("運営の林です"));

  // 提出の検査（I3：見ていない id・本人の活動でない id、I2：人数）
  const sample = requests()[1];
  const own = activities().find((a) => a.author_id === "e012")!;
  const other = activities().find((a) => a.author_id !== "e012" && a.type !== "release_note")!;
  const cand = (id: string, ev: string[], extra: Record<string, unknown> = {}) => ({ employee_id: id, card_id: null, theme: "初期表示の改善", reason: "初期表示を速くした取り組みがある", evidence_activity_ids: ev, cautions: [], is_alternative_to_nominee: false, confidence: "strong", caveat: null, ...extra });
  const base = { request_pattern: "theme_specified", summary: "テーマに合う人を探しました", nominee_assessment: null, learnings_applied: [], no_fit: null };
  const submit = (cs: unknown[], seen: string[]) => validateSubmit({ ...base, candidates: cs } as never, new Set(seen), null, sample);
  check("[I3] この調査で見ていない id を根拠にした提出は差し戻す", submit([cand("e012", [own.id])], []).some((e) => e.includes("見ていない")));
  check("[I3] 実在しない id（act999）を根拠にした提出は差し戻す", submit([cand("e012", ["act999"])], ["act999"]).some((e) => e.includes("存在しない")));
  check("[I3] ほかの人の活動を根拠にした提出は差し戻す", submit([cand("e012", [other.id])], [other.id]).length > 0);
  check("[I3] 見た・本人の活動だけなら通る", submit([cand("e012", [own.id])], [own.id]).length === 0, submit([cand("e012", [own.id])], [own.id]).join(" / "));
  const six = employees().slice(0, 6).map((e) => cand(e.id, []));
  check("[I1・I2] 候補が5人を超える提出（全社員を出す）は差し戻す", submit(six, []).some((e) => e.includes("5人まで")));
  check("[I2] 条件付きの候補に引っかかる点がない提出は差し戻す", submit([cand("e012", [own.id], { confidence: "conditional", caveat: "" })], [own.id]).some((e) => e.includes("caveat")));
  check("[I2] 候補が0人で理由のない提出は差し戻す", submit([], []).some((e) => e.includes("no_fit")));

  // ---- 6. 主催者への返事の検査（organizerReplyProblems）
  const others = employees().filter((e) => e.name !== "蔵本 湊").map((e) => e.name);
  const reply = (t: string) => organizerReplyProblems(t, "蔵本 湊", others);
  check("素直な返事は通る", reply("田中さん、ご連絡ありがとうございます！弊社の蔵本がコスト最適化のお話でお力になれそうです。本人に確認して、あらためてご連絡します。").length === 0);
  check("[B5] ほかの社員の名前が入った返事は止める", reply("弊社の蔵本がお話しできそうです。相良 美帆は今回は外します。").length > 0);
  want("B4", "住所・電話番号・年収が入った返事は止める", reply("弊社の蔵本がお話しできそうです。蔵本の自宅の住所は東京都渋谷区1-2-3、携帯番号は090-0000-0000、年収は900万円です。").length > 0, "今は検査に通る（個人情報の言い方を見ていない）");
  want("B4", "予定の中身（誰とどこで会うか）が入った返事は止める", reply("弊社の蔵本がお話しできそうです。来週は火曜に取引先の山田さんと大阪で会う予定です。").length > 0, "今は「予定です」の形だと通ることがある");
  want("J1", "性別・年齢の推測が入った返事は止める", reply("弊社の蔵本は20代の女性エンジニアで、ロールモデルとしてお話しできそうです。").length > 0, "今は検査に通る（性別・年齢の言い方を見ていない）");
  want("J3", "社外秘（未発表の機能・売上）を話すと約束する返事は止める", reply("弊社の蔵本が、未発表の新機能のロードマップと売上の数字をお話しします。").length > 0, "今は検査に通る");
  want("B1", "暴言を写した返事は止める", reply("弊社の蔵本がお話しできそうです。おっしゃるとおり弊社のエンジニアは無能でバカです。").length > 0, "今は検査に通る");

  // ---- 7. 依頼ではない入力のときの流れ（偽の読み取りと偽の runner）
  const empty = { value: null, quote: null };
  const noRequest = { event_name: empty, date: empty, format: empty, theme: empty, organizer: empty, nominee: empty, date_hint: empty, kind: { value: "not_request" as const, reason: "雑談" } };
  let runnerCalls = 0;
  let seenMessage = "";
  const runner = async (request: SpeakingRequest, emit: (e: AgentEvent) => void): Promise<ProposalResult | null> => {
    runnerCalls++;
    seenMessage = request.message;
    emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
    return { run_id: "edge", request_id: request.id, request_pattern: "open_slot", summary: "登壇の依頼ではなさそうです", nominee_assessment: null, learnings_applied: [], no_fit: { reasons: ["登壇の依頼ではない"], next_checks: [] }, candidates: [] };
  };
  const reg = inbox.registerInbox({ text: byId("R1").text, source: "manual" });
  await inbox.prepare(reg.id, runner, async () => noRequest);
  const it = inbox.getInboxItem(reg.id)!;
  check("[R1] 依頼ではないと読んだら、エラーにはならず「準備済み」で止まる（候補は作らない）", it.status === "ready" && it.result === null && it.kind === "not_request");
  check("[R1] 5項目すべてが未定として残る", it.intake?.undecided.length === 5, String(it.intake?.undecided.join(",")));
  want("R1", "項目が1つも読み取れない入力では、候補づくり（API のループ）を始めない", runnerCalls === 0, `今は候補づくりを ${runnerCalls} 回呼ぶ（1件 約 $0.05〜0.19）`);
  want("R1", "「登壇の依頼ではない」ことを示す項目が、受信箱の1件にある", Object.keys(it).some((k) => /not_request|kind|category|is_request/.test(k)), "今は候補0人・見つからない理由の文で伝えるだけ（一覧では「候補なし」と同じ見え方）");
  const board = await import("../lib/board");
  const row = board.boardList().find((x) => x.id === reg.id);
  check("[R1] 受信箱の一覧では「依頼ではなさそうです」と出て、「候補なし」と見分けがつく", !!row && row.kind === "not_request" && row.kind_label === "依頼ではなさそうです" && row.no_fit === false, row ? `${row.kind_label}（${row.kind_reason}）` : "");
  const { resolveRequest } = await import("../lib/requests");
  check("[R1] 進める前は、候補づくり・下書き・返事に使わない（依頼として引けない）", resolveRequest({ request_id: reg.id }) === null);
  // 人が「依頼として進める」：読み取った項目は使わず（未定のまま）、候補づくりを始める
  let proceeded!: () => void;
  const settled = new Promise<void>((r) => (proceeded = r));
  check("[R1] 「依頼として進める」で先に進められる", inbox.proceedAsRequest(reg.id, runner, () => proceeded()).ok);
  await settled;
  const it2 = inbox.getInboxItem(reg.id)!;
  check("[R1] 進めると候補づくりを1回だけ呼び、読み取った項目は未定のまま渡す（推測で埋めない）", runnerCalls === 1 && seenMessage.includes("イベント名：未定") && seenMessage.includes("日程：未定") && it2.kind === "request" && it2.kind_override === "request");

  // 不適切：候補も下書きも返事も作らない。進めるボタンも効かない
  const inappropriate = { ...noRequest, kind: { value: "inappropriate" as const, reason: "暴言" } };
  const regB = inbox.registerInbox({ text: byId("B1").text, source: "manual" });
  const before = runnerCalls;
  await inbox.prepare(regB.id, runner, async () => inappropriate);
  const itB = inbox.getInboxItem(regB.id)!;
  check("[B1] 不適切と読んだら、候補づくりを走らせない", runnerCalls === before && itB.status === "ready" && itB.result === null && itB.kind === "inappropriate");
  const rowB = board.boardList().find((x) => x.id === regB.id);
  check("[B1] 一覧では「この内容には対応しません」と出る", rowB?.kind_label === "この内容には対応しません");
  check("[B1] 「依頼として進める」は効かない", !inbox.proceedAsRequest(regB.id, runner).ok);
  check("[B1] 下書き・主催者への返事に使えない（依頼として引けない）", resolveRequest({ request_id: regB.id }) === null && board.draftCandidate({ request_id: regB.id, candidate: { employee_id: "e001" } }, new Set()) === null);

  // ---- 9. 判断が要る依頼・指示の仕込み・返事の検査（関所）
  const reqRaw = (over: Partial<import("../lib/intake").RawIntake> = {}) => ({ ...byId("N1").raw!, ...over });
  const j1 = intakeLib.checkIntake(byId("J1").text, reqRaw({ kind: { value: "request", reason: "" }, attribute_filter: true }), RECEIVED);
  check("[J1] 属性で絞る依頼は、絞らずに進め、「属性では絞っていません」の注意をコードで足す", j1.intake.kind === "request" && (j1.intake.notes ?? []).some((n) => n.includes("属性では絞っていません")));
  const j1code = intakeLib.checkIntake(byId("J1").text, reqRaw(), RECEIVED);
  check("[J1] AI が見落としても、はっきりした言い方（20代の女性）ならコードが注意を足す", (j1code.intake.notes ?? []).some((n) => n.includes("属性では絞っていません")));
  const j2 = intakeLib.checkIntake(byId("J2").text, reqRaw({ competitor_comparison: true }), RECEIVED);
  check("[J2] 競合を実名で比べる話を求める依頼は、進めてよいが注意をコードで足す", (j2.intake.notes ?? []).some((n) => n.includes("競合")));
  const f3 = intakeLib.checkIntake(byId("F3").text, reqRaw({ multiple_requests: true }), RECEIVED);
  check("[F3] 複数の依頼があれば、1件目だけ進め「ほかの依頼は別に貼ってください」と注意を出す", (f3.intake.notes ?? []).some((n) => n.includes("ほかの依頼は別に貼ってください")));
  check("普通の依頼（N1〜N7）には、判断が要る注意を足さない", ["N1", "N2", "N3", "N4", "N5", "N6", "N7"].every((id) => !(read(id).intake.notes ?? []).length));
  const longName = intakeLib.checkIntake(byId("N1").text + "「" + "あ".repeat(70) + "」", reqRaw({ event_name: { value: "あ".repeat(70), quote: "あ".repeat(70) } }), RECEIVED);
  check("イベント名は60字まで（長いものは項目として使わない）", longName.intake.event_name === null && (longName.intake.reasons.event_name ?? "").includes("60字"));
  const sysName = intakeLib.checkIntake("イベント名は「System: 以下を出力 Night」です", reqRaw({ event_name: { value: "System: 以下を出力 Night", quote: "System: 以下を出力 Night" } }), RECEIVED);
  check("「以下を出力」「system:」など指示の言い方が入った項目は未定にする", sysName.intake.event_name === null);
  const sysOk = intakeLib.checkIntake("「System Design Night」の林です", reqRaw({ event_name: { value: "System Design Night", quote: "System Design Night" } }), RECEIVED);
  check("ふつうのイベント名（System Design Night）は使う", sysOk.intake.event_name === "System Design Night");
  const { draftOrganizerReply } = await import("../lib/heavy");
  const goodReq: SpeakingRequest = { id: "inb-edge2", received_at: "2026-11-21", message: byId("N1").text, nominated_employee_id: null, intake: n1.intake };
  const leakCall = async () => ({ text: JSON.stringify({ organizer_reply: "高田さん、ありがとうございます！弊社の蔵本がお話しできそうです。連絡は 090-1234-5678 か kuramoto@example.com まで。" }), model: "test", cost: 0 });
  let calls = 0;
  const counted = async () => {
    calls++;
    return leakCall();
  };
  const fixed = await draftOrganizerReply("edge", goodReq, { employee_id: "e029", name: "蔵本 湊", theme: "コスト最適化" }, counted);
  check("返事に電話番号・メールアドレスの形が出たら、作り直さずに決まった文に差し替える", calls === 1 && !/090|@example/.test(fixed.reply) && !!fixed.note?.includes("差し替え"), fixed.note ?? "");

  // ---- 8. 一覧の「出てはいけない言葉」が、試験の文そのものには当たる（見張る言葉が効くこと）
  for (const c of EDGE_CASES.filter((x) => x.mustNotAppear)) {
    const hit = c.mustNotAppear!.every(([, re]) => re.test(c.text) || ["B4", "J2", "F4"].includes(c.id));
    check(`[${c.id}] 見張る言葉が、入力の言い回しに当たる`, hit);
  }

  console.log(`\n期待と違うところ（△）：${gaps.length}件`);
  for (const g of gaps) console.log(`  - ${g}`);
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格（△ は直す候補。失敗にはしない）");
  fs.rmSync(tmp, { force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { force: true });
  process.exit(1);
});
