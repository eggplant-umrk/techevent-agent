import "./_isolate"; // 元のデータだけで動かす。「今日」は 2026-11-21 に固定
// 読み取りの弱いところ2つ（docs/evals.md の安定性の評価で見つかった N2・F3）の直しのテスト。API は使わない。
//   npm run test:intakefix   （npm test にも入る）
// - N2：Agent が日程を返さなくても、会話の最後のほうの「決まりました」の一節の日付が1日に決まり、曜日が合えば、コードで決まった日とする
// - F3：複数の依頼が混ざっているときは、1件目の依頼の範囲の中だけで日付を決める
// 偽の読み取りは、本番で Agent が実際に返した形（N2：日程も手がかりもなし／F3：日程なし・手がかりに「1月15日（金）」・複数の依頼あり）
import type { RawIntake } from "../lib/intake";
import { EDGE_CASES } from "./fixtures/edge_cases";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}
const byId = (id: string) => EDGE_CASES.find((c) => c.id === id)!;
const RECEIVED = "2026-11-21T10:00:00+09:00";
const q = (value: string | null, quote: string | null = value) => ({ value, quote });
const none = q(null, null);

async function main() {
  const { checkIntake, announcedDate, firstRequestScope, NOTE_MULTIPLE } = await import("../lib/intake");

  // ---- 1. N2：あとから日程が決まる会話
  const n2 = byId("N2");
  /** 本番で5回中4回返ってきた形：日程も手がかりも返さない */
  const n2Raw: RawIntake = { ...n2.raw!, date: none, date_hint: none };
  const read = (text: string, raw: RawIntake) => checkIntake(text, raw, RECEIVED).intake;
  const r = read(n2.text, n2Raw);
  check("[N2] Agent が日程を返さなくても、「決まりました！1月27日（水）」から 2027-01-27 に決まる", r.date === "2027-01-27" && !r.undecided.includes("date") && !r.reasons.date && r.date_hint === null, `${r.date}／${r.reasons.date ?? ""}`);
  check("[N2] 前の行の候補日（1月20日（水）か27日（水））は使わない・数えない", announcedDate(n2.text, RECEIVED)?.date === "2027-01-27");
  check("[N2] Agent が日程を返したとき（今までどおりの読み取り）も同じ日", read(n2.text, n2.raw!).date === "2027-01-27");
  const candidateQuote = read(n2.text, { ...n2.raw!, date: q("2027-01-20", "1月20日（水）か27日（水）で調整中でした") });
  check("[N2] Agent が候補日の一節を引用しても、決まった一節の日（1月27日）になる", candidateQuote.date === "2027-01-27", String(candidateQuote.date));
  const swap = (a: string, b: string) => n2.text.replace(a, b);
  check("曜日が暦と合わなければ決めない（1月27日は水曜）", read(swap("決まりました！1月27日（水）", "決まりました！1月27日（火）"), n2Raw).date === null);
  check("曜日が書かれていなくても、日付が1日に決まれば決める", read(swap("決まりました！1月27日（水）", "決まりました！1月27日"), n2Raw).date === "2027-01-27");
  check("「確定しました」「決定です」でも決まる", read(swap("決まりました！", "日程が確定しました。"), n2Raw).date === "2027-01-27" && read(swap("決まりました！", "決定です！"), n2Raw).date === "2027-01-27");
  check(
    "「決まりましたら」は、まだ決まっていない（決めない）",
    read(swap("決まりました！1月27日（水）19時半〜、", "決まりましたらご連絡します。1月27日（水）あたりかもしれません。"), n2Raw).date === null && announcedDate("日程が決まりましたらご連絡します。1月27日（水）の予定です", RECEIVED) === null,
  );
  check("決まった一節に日付が2つあれば決めない", read(swap("決まりました！1月27日（水）", "決まりました！1月27日（水）か28日（木）"), n2Raw).date === null);
  check("決まった一節に「候補」「調整中」があれば決めない", announcedDate("会場は決まりました。日程は1月27日（水）が候補です", RECEIVED) === null);
  check("決まったのが日程でなさそうなら決めない（会場が決まりました）", announcedDate("会場が決まりました！1月27日（水）に下見に行きます", RECEIVED) === null && announcedDate("テーマは決まりました。1月27日（水）にお送りします", RECEIVED) === null);
  check("「日程が決まりました」は決める", announcedDate("日程が決まりました！1月27日（水）19時からです", RECEIVED)?.date === "2027-01-27");
  check("決まった一節より後ろに別の日付があれば決めない", read(`${n2.text}\n@layerx_techpr すみません、2月3日（水）になるかもしれません`, n2Raw).date === null);
  check("決まった一節より後ろに「再調整」「延期」などがあれば決めない", read(`${n2.text}\n@layerx_techpr すみません、やっぱり再調整になりそうです`, n2Raw).date === null && read(`${n2.text}\n@layerx_techpr 延期になりました`, n2Raw).date === null);
  check("予備日・締切の日付が後ろにあっても、決まった日はそのまま（今までの決まり）", read(`${n2.text}\n@layerx_techpr 資料の締切は1月20日（水）です`, n2Raw).date === "2027-01-27");
  const two = `${n2.text}\n@layerx_techpr 失礼しました、確定しました！2月3日（水）19時半〜です`;
  check("「決まりました」が2回あれば、いちばん後ろの一節を使う", read(two, n2Raw).date === "2027-02-03", String(read(two, n2Raw).date));
  check("暦にない日付は決めない（2月30日）", announcedDate("決まりました！2月30日19時〜です", RECEIVED) === null);
  const n4 = read(byId("N4").text, { ...byId("N4").raw!, date: none });
  check("「決まりました」のない会話は、今までどおり未定（N4：2月か3月）", n4.date === null && n4.date_hint === "2月か3月");
  const notReq = read(n2.text, { ...n2Raw, kind: { value: "not_request", reason: "雑談" } });
  check("依頼ではないと読んだ文では、決めない", notReq.date === null);

  // ---- 2. F3：複数の依頼が混ざっている
  const f3 = byId("F3");
  /** 本番で5回とも返ってきた形：日程なし、手がかりに「1月15日（金）」、複数の依頼あり */
  const f3Raw: RawIntake = {
    event_name: q("Kotlin Fest mini"),
    date: none,
    format: q("LT（10分）"),
    theme: q("サーバーサイド Kotlin", "サーバーサイド Kotlin の話"),
    organizer: q("橋本"),
    nominee: none,
    date_hint: q("1月15日（金）", "1月15日（金）のLT（10分）で"),
    multiple_requests: true,
  };
  const f = read(f3.text, f3Raw);
  check("[F3] 1件目の日程（1月15日（金））が 2027-01-15 に決まる（別件の 2月24日 を食い違いとして数えない）", f.date === "2027-01-15" && !f.undecided.includes("date") && f.date_hint === null, `${f.date}／${f.reasons.date ?? ""}`);
  check("[F3] 「ほかの依頼は別に貼ってください」の注意は今までどおり出る", (f.notes ?? []).includes(NOTE_MULTIPLE));
  check("[F3] Agent が日程として返したときも同じ", read(f3.text, { ...f3Raw, date: q("2027-01-15", "1月15日（金）のLT（10分）で"), date_hint: none }).date === "2027-01-15");
  const single = read(f3.text, { ...f3Raw, multiple_requests: false });
  check("Agent が「複数の依頼」と答えていなければ、今までどおり（後ろの別の日付があるので未定）", single.date === null && single.undecided.includes("date"));
  const second = read(f3.text, { ...f3Raw, date: q("2027-02-24", "2月24日（水）のトーク（20分）で"), date_hint: none });
  check("読み取った日程の一節が1件目の範囲になければ（2件目の日付）、決めない", second.date === null && (second.reasons.date ?? "").includes("見つからない"), second.reasons.date ?? "");
  const noBreak = "「Kotlin Fest mini」の橋本です。1月15日（金）のLT（10分）をお願いできますか。あと、2月24日（水）のトーク（20分）もお願いしたいです。";
  check("区切りが見つからない文は、今までどおり未定（人に返す）", read(noBreak, f3Raw).date === null);
  check("区切り：記号だけの行（--- ===== ＝＝＝ ━━━━ ***）", ["---", "=====", "＝＝＝", "━━━━", "***"].every((sep) => firstRequestScope(`1件目です\n${sep}\n2件目です`) === "1件目です\n"));
  check("区切り：「別件」「もう1件」「2件目」で始まる行", ["別件です。", "もう1件あります。", "もう一件、", "2件目："].every((w) => firstRequestScope(`1件目です\n${w}2月24日のトーク`) === "1件目です\n"));
  check("文の途中の「別件」や、短い「--」は区切りにしない", firstRequestScope("これは別件ではなく同じ話です\n--\n続きです") === "これは別件ではなく同じ話です\n--\n続きです");
  check("区切りが先頭にあるとき（1件目が空）は、全体を使う", firstRequestScope("---\n1件目です") === "---\n1件目です");
  const corrected = "「Kotlin Fest mini」の橋本です。1月15日（金）のLT（10分）をお願いできますか。\n---\n訂正です。1月22日（金）でした。";
  check("区切りのあとが訂正（Agent は複数の依頼と答えない）なら、今までどおり未定", read(corrected, { ...f3Raw, multiple_requests: false }).date === null);
  const f3Announced =
    "「Kotlin Fest mini」の橋本です。1月15日（金）か22日（金）で調整中です。\n日程が決まりました！1月22日（金）のLT（10分）でお願いします。\n---\n別件です。「AI Agent Builders」の千葉です。2月24日（水）のトーク（20分）で、LLM の評価の話をお願いしたいです。";
  const fa = read(f3Announced, { ...f3Raw, date_hint: none });
  check("複数の依頼でも、1件目の範囲の中の「決まりました」の一節から決まる", fa.date === "2027-01-22", String(fa.date));

  // ---- 3. 普通の依頼は変わらない（試験の一覧の、偽の読み取りがある件）
  const before: Record<string, string | null> = { N1: "2026-12-10", N2: "2027-01-27", N3: "2027-02-05", N4: null, N5: "2027-03-12", N6: "2027-01-14", N7: "2027-02-18", I1: "2027-01-29", F5: "2027-01-22", A1: "2027-01-19", A2: "2027-02-09", A3: "2027-03-03" };
  const changed = Object.entries(before).filter(([id, date]) => read(byId(id).text, byId(id).raw!).date !== date);
  check("偽の読み取りがある12件（N1〜N7・I1・F5・A1〜A3）の日程は、直しの前（main）と同じ", changed.length === 0, changed.map(([id]) => `${id}=${read(byId(id).text, byId(id).raw!).date}`).join("／"));
  const decidedWithoutAgent = EDGE_CASES.filter((c) => c.raw)
    .filter((c) => read(c.text, { ...c.raw!, date: none, date_hint: none }).date !== null)
    .map((c) => c.id)
    .join(",");
  check("偽の読み取りがある件で、Agent が日程を返さなかったら：決まるのは N2 だけ（ほかは未定のまま）", decidedWithoutAgent === "N2", decidedWithoutAgent);

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
