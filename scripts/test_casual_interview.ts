// アンケートの「カジュアル面談の希望」のテスト（API を使わない）：npx tsx scripts/test_casual_interview.ts
// 列の見分け方・はい／いいえの読み替え・人数と行番号・個人情報が残らないこと・下書きに名前や連絡先が入らないこと。
import "./_isolate"; // 元のデータだけで動かす（実行時のデータ data/runtime/ は読まない・書かない）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "casual-interview-test-"));
process.env.SURVEY_IMPORT_DIR = path.join(TMP, "imports");
process.env.SURVEY_ANALYSIS_FILE = path.join(TMP, "analysis.json");

import { INTERVIEW_HEADER, interviewAnswer, interviewDraft, rowOfAnswerId, rowsLabel } from "../lib/casualInterview";
import { employeeById, events } from "../lib/data";
import { detectColumns, importSurveyCsv, loadImport, saveImport } from "../lib/surveyCsv";
import { eventDetail, eventMessage, PER_SPEAKER_KEYS } from "../lib/surveys";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `　${detail}` : ""}`);
  if (!ok) failed++;
}

const PERSONAL = ["山田 花子", "佐藤 健", "hanako@example.com", "ken.sato@example.jp", "090-1234-5678", "@hanako_dev"];

async function main() {
  // ---------------------------------------------------------------- 列の見分け方
  {
    const role = (h: string) => detectColumns(["タイムスタンプ", h])[1].role;
    for (const h of ["カジュアル面談を希望しますか？", "面談のご希望", "登壇者の話を聞いてみたいですか", "採用に興味はありますか", "ｶｼﾞｭｱﾙ面談を希望しますか"])
      check(`「${h}」は面談の希望の列`, role(h) === "interview", role(h));
    check("面談の希望を聞かない列は今までどおり", role("次に聞きたいテーマがあれば教えてください") === "want_next" && role("感想・ご意見") === "comment" && role("満足度を教えてください") === "rating");
    check("見分けられない列は今までどおり無視", role("当日の天気はどうでしたか") === "unread");
    check("面談の連絡先を書かせる列は個人情報として捨てる（先に見る）", role("面談を希望される方は連絡先を書いてください") === "personal" && role("面談用のメールアドレス") === "personal");
    check("面談の希望の列は1つだけ（2つ目は無視）", detectColumns(["カジュアル面談を希望しますか", "採用の話を聞きたいですか"]).map((c) => c.role).join(",") === "interview,unread");
    check("質問文のキーワードはコードの決まり（INTERVIEW_HEADER）", INTERVIEW_HEADER.test("カジュアル面談") && !INTERVIEW_HEADER.test("次に聞きたいテーマ"));
  }

  // ---------------------------------------------------------------- はい／いいえ
  {
    const yes = ["はい", "はい、話を聞いてみたい", "希望する", "希望します", "ぜひ", "Yes", "ＹＥＳ", "y", "○", "興味あり"];
    const no = ["いいえ", "希望しない", "希望しません", "不要", "今はいいです", "No", "no thanks", "×", "特になし", "興味はありません"];
    const none = ["", "  ", "検討中", "わからない"];
    check("「はい」と読む値", yes.every((v) => interviewAnswer(v) === "yes"), yes.filter((v) => interviewAnswer(v) !== "yes").join("・"));
    check("「いいえ」と読む値（「希望しない」は希望に数えない）", no.every((v) => interviewAnswer(v) === "no"), no.filter((v) => interviewAnswer(v) !== "no").join("・"));
    check("どちらとも読めない値は数えない", none.every((v) => interviewAnswer(v) === null), none.filter((v) => interviewAnswer(v) !== null).join("・"));
  }

  // ---------------------------------------------------------------- 人数と行番号（取り込み）
  const ev = events().find((e) => e.id === "ev019")!;
  const [sA, sB] = ev.speaker_ids.map((id) => employeeById(id)!.name);
  const csv =
    "タイムスタンプ,メールアドレス,お名前,電話番号,どの登壇についての回答ですか？,満足度を教えてください,感想,カジュアル面談を希望しますか？\n" +
    `2026/09/11 21:00:00,hanako@example.com,山田 花子,090-1234-5678,${sA}「本番運用」,5,とても良かった,はい\n` + // 2行目：希望（A）
    `2026/09/11 21:01:00,,,,${sA}「本番運用」,4,参考になった,いいえ\n` + // 3行目
    `2026/09/11 21:02:00,ken.sato@example.jp,佐藤 健,,${sB}「選定基準」,3,@hanako_dev さんに紹介したい,希望します\n` + // 4行目：希望（B）
    `2026/09/11 21:03:00,,,,${sA}「本番運用」,2,難しかった,\n` + // 5行目：空欄
    `2026/09/11 21:04:00,,,,だれの登壇か分からない,4,よかった,ぜひ\n` + // 6行目：希望（登壇不明）
    `2026/09/11 21:05:00,,,,${sA}「本番運用」,5,最高,はい\n`; // 7行目：希望（A）
  const r = await importSurveyCsv("ev019", csv, { source: "upload" });
  check("取り込める", r.ok, r.ok ? "" : r.error);
  if (!r.ok) return finish();
  const ci = r.data.casual_interview!;
  check("合計の人数（どの登壇か分からない希望も入れる）", ci.total === 4, `${ci.total}人`);
  check("希望した回答の行番号（スプレッドシートの行番号）", ci.rows.join(",") === "2,4,6,7", ci.rows.join(","));
  check("登壇ごとの人数", ci.by_talk[ev.speaker_ids[0]] === 2 && ci.by_talk[ev.speaker_ids[1]] === 1, JSON.stringify(ci.by_talk));
  check("行番号は回答 id（ev019-r12 → 12）と同じ数え方", r.data.answers.every((a) => rowOfAnswerId(a.id)! >= 2) && rowOfAnswerId("ev019-r12") === 12 && r.data.unmatched_rows.includes(6));
  check("行番号の書き方「12行目・27行目」", rowsLabel([12, 27]) === "12行目・27行目");
  check("残すのは質問文・人数・行番号・登壇ごとの人数だけ", Object.keys(ci).sort().join(",") === "by_talk,header,rows,total");

  // ---------------------------------------------------------------- 個人情報が残らない
  saveImport(r.data);
  const saved = fs.readFileSync(path.join(TMP, "imports", "ev019.json"), "utf-8");
  check("保存したファイルに名前・メール・電話番号・アカウントが残らない", PERSONAL.every((p) => !saved.includes(p)), PERSONAL.filter((p) => saved.includes(p)).join("・"));
  check("回答にも面談の希望の値は入れない（人数と行番号だけ）", r.data.answers.every((a) => !("casual_interview" in a) && !Object.values(a).includes("希望します")));
  const d = eventDetail("ev019")!;
  const dj = JSON.stringify(d.casual_interview);
  check("画面の窓口：取り込んだものの人数と行番号", d.casual_interview?.total === 4 && d.casual_interview.rows.join(",") === "2,4,6,7");
  check("画面の窓口：登壇ごとは名前・タイトル・人数だけ", d.casual_interview!.talks.every((t) => Object.keys(t).sort().join(",") === "count,name,title"));
  check("画面の窓口に個人情報が入らない", PERSONAL.every((p) => !JSON.stringify(d).includes(p)));
  check("画面の窓口の面談の希望に、登壇ごとの満足度・不満が入らない", PER_SPEAKER_KEYS.every((k) => !dj.includes(`"${k}"`)) && !/rating|average|complaint|negative|満足/.test(dj));
  check("AI に渡す文に面談の希望を入れない（API を使う分析には関係しない）", !/面談/.test(eventMessage(ev)));
  fs.rmSync(path.join(TMP, "imports"), { recursive: true, force: true });

  // ---------------------------------------------------------------- 見分けられないとき
  const noCol = await importSurveyCsv("ev019", `タイムスタンプ,どの登壇についての回答ですか？,満足度を教えてください\n2026/09/11 21:00:00,${sA}「x」,5\n`, { source: "upload" });
  check("面談の希望の列がなければ持たない（今までどおり）", noCol.ok && noCol.data.casual_interview === undefined);

  // ---------------------------------------------------------------- 架空のアンケート（デモ用）
  const demo = loadImport("ev019")!;
  check("架空のアンケートに面談の希望の列がある", demo.columns.some((c) => c.role === "interview") && demo.casual_interview?.total === 3, JSON.stringify(demo.casual_interview));
  check("架空のアンケート ev019：12行目・27行目・33行目", demo.casual_interview?.rows.join(",") === "12,27,33");
  for (const e of events().filter((x) => loadImport(x.id)))
    check(`${e.id}：面談の希望の合計＝登壇ごとの合計（登壇不明なし）`, Object.values(loadImport(e.id)!.casual_interview?.by_talk ?? {}).reduce((a, b) => a + b, 0) === loadImport(e.id)!.casual_interview?.total);
  const dd = eventDetail("ev019")!;
  check("架空のアンケートの画面の窓口", dd.casual_interview?.total === 3 && dd.casual_interview.talks.find((t) => t.name === sA)?.count === 3 && dd.casual_interview.talks.find((t) => t.name === sB)?.count === 0);

  // ---------------------------------------------------------------- 登壇者へ伝える文の下書き
  const draft = interviewDraft({ speakerName: sA, eventTitle: ev.title, count: 2 });
  const family = sA.split(/\s+/)[0];
  check("下書きに登壇者の名前・イベント名・人数が入る", draft.startsWith(`${family}さん、${ev.title}でのご登壇ありがとうございました。`) && draft.includes("2人が、カジュアル面談を希望しています") && draft.endsWith("詳しくは技術広報から連絡します。"), draft);
  check("下書きに希望した方の名前・連絡先が入らない", PERSONAL.every((p) => !draft.includes(p)) && !/@|\d{2,4}-\d{2,4}-\d{3,4}|行目/.test(draft));
  // 画面：下書きは編集とコピーだけ（送信の窓口を呼ばない）。登壇ごとの満足度は出さない
  const src = fs.readFileSync(path.join(process.cwd(), "components", "Events.tsx"), "utf-8");
  const section = src.slice(src.indexOf("function CasualInterviewSection"), src.indexOf("function SourceInfo"));
  check("画面の面談の希望は API を呼ばない（送信しない。編集とコピーだけ）", section.length > 0 && !/api\.|fetch\(|slack/i.test(section) && /CopyButton/.test(section) && /<textarea/.test(section));
  check("画面に個人情報についての注意を書く", section.includes("個人情報を守るため、希望した方の名前や連絡先はこのアプリに保存していません。元のスプレッドシートの該当の行で確認してください。"));
  check("画面の面談の希望に満足度・不満を出さない", !/rating|満足|不満|negatives/.test(section));

  finish();
}

function finish() {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed === 0 ? "\nすべて合格" : `\n${failed}件 不合格`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
