// 「例を入れる」ボタンの中身（data/demo_conversations.json）のテスト（API を使わない）：npx tsx scripts/test_demo_conversations.ts
import "./_isolate";
import fs from "node:fs";
import path from "node:path";
import { demoConversations, demoIdsIn, lockedNote, MAX_DEMO_CONVERSATIONS } from "../lib/demoConversations";
import { hasRequestText } from "../lib/requestText";
import { employees } from "../lib/data";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

const list = demoConversations();
check("例は3つ（ファイルの並びのとおり）", list.length === 3 && list.map((c) => c.id).join(",") === "ex1,ex2,ex3", list.map((c) => c.id).join(","));
check(
  "ボタンの文字",
  list.map((c) => c.label).join(" / ") === "例1：日程の候補が3つ / 例2：指名の依頼 / 例3：例2の続き（主催者から返事が来た）",
  list.map((c) => c.label).join(" / "),
);
const msgs = (t: string) => t.split(/\n\s*\n/).map((m) => m.trim());
const [ex1, ex2, ex3] = list;
check("例1：メッセージ3つ・日程の候補が3つ", msgs(ex1.text).length === 3 && ["12月15日", "12月17日", "1月14日"].every((d) => ex1.text.includes(d)));
check("例2は例3の最初の3つのメッセージ（西村さんの依頼から「本人に確認してみます」まで）", msgs(ex2.text).length === 3 && msgs(ex3.text).slice(0, 3).join("\n\n") === msgs(ex2.text).join("\n\n") && msgs(ex2.text)[2].includes("本人に確認してみます"));
check("例3：メッセージ5つ（主催者からの返事で終わる）", msgs(ex3.text).length === 5 && msgs(ex3.text)[4].startsWith("@infra_study_tokyo"));
check("どの例も依頼の文として受け付けられる（関所の hasRequestText）", list.every((c) => hasRequestText(c.text)));
const names = employees().map((e) => e.name.replace(/\s/g, ""));
check("例に出てくる社員（芹沢・鳴海）は社員データにいる", ["芹沢葵", "鳴海慎"].every((n) => names.includes(n)));
check("例は架空のもの（URL・メールアドレスを入れない）", list.every((c) => !/https?:\/\/|[\w.+-]+@[\w-]+\.[\w.]+/.test(c.text)));

// 形の崩れたファイルでも落ちない
check("形が違えば空（画面に出さない）", demoConversations(null).length === 0 && demoConversations({ conversations: "x" }).length === 0);
check(
  "項目が欠けたもの・空のもの・同じ id は飛ばす",
  demoConversations({ conversations: [{ id: "a", label: "A", text: "t" }, { id: "b", label: "", text: "t" }, { id: "c", label: "C" }, { id: "a", label: "A2", text: "t2" }] })
    .map((c) => c.id)
    .join(",") === "a",
);
check(
  `ボタンは${MAX_DEMO_CONVERSATIONS}つまで`,
  demoConversations({ conversations: [1, 2, 3, 4].map((i) => ({ id: `x${i}`, label: `L${i}`, text: `T${i}` })) }).length === MAX_DEMO_CONVERSATIONS,
);

// 例3は、受信箱に例2の依頼があるときだけ押せる（requires）
check("例3は例2を requires にする（例1・例2はなし）", !ex1.requires && !ex2.requires && ex3.requires === "ex2");
check("例2がないとき：「例2を入れると使えます」", lockedNote(ex3, [], list) === "例2を入れると使えます");
check("例2があるとき：押せる（一言なし）", lockedNote(ex3, ["ex2"], list) === null && lockedNote(ex1, [], list) === null && lockedNote(ex2, [], list) === null);
check("例1だけがあっても、例3は押せない", lockedNote(ex3, ["ex1"], list) !== null);
check("受信箱の会話に入っている例：例2そのもの → ex2", demoIdsIn(ex2.text, list).join(",") === "ex2");
check("続きの会話で更新された依頼（例3の会話）にも例2が入っている → ex2・ex3", demoIdsIn(ex3.text, list).join(",") === "ex2,ex3");
check("空白・改行の違いは気にしない", demoIdsIn(ex2.text.replace(/\n\n/g, "\n").replace(/ /g, "　"), list).includes("ex2"));
check("一部だけ・関係ない文は入らない", demoIdsIn(ex2.text.slice(0, 40), list).length === 0 && demoIdsIn("こんにちは", list).length === 0);
check(
  "並びにない例を requires にしていたら外す（押せないままにしない）",
  demoConversations({ conversations: [{ id: "a", label: "A", text: "t", requires: "zzz" }] })[0].requires === undefined,
);

async function inboxChecks() {
  // 受信箱の一覧（GET /api/inbox の items）に demo_ids が付く。見せる用では、見る人ごとの受信箱（INBOX_FILE が人の場所）で作る
  const inbox = await import("../lib/inbox");
  const { boardList } = await import("../lib/board");
  const before = boardList().some((x) => (x as { demo_ids?: string[] }).demo_ids?.includes("ex2"));
  const it = inbox.registerInbox({ text: ex2.text, source: "manual" });
  const row = boardList().find((x) => x.id === it.id) as { demo_ids?: string[] } | undefined;
  check("受信箱の一覧：例2を入れる前は印がない", !before);
  check("受信箱の一覧：例2を入れると、その依頼に demo_ids: ex2", row?.demo_ids?.join(",") === "ex2", JSON.stringify(row?.demo_ids));
  const other = inbox.registerInbox({ text: "「Mock Night」運営です。12月18日（金）19時〜、LT10分で登壇をお願いできる方を探しています。", source: "manual" });
  check("関係ない依頼には印がない", (boardList().find((x) => x.id === other.id) as { demo_ids?: string[] })?.demo_ids?.length === 0);
}

// 画面：発表用と見せる用で同じ部品（RequestInput の custom）に出す。見せる用だけ隠すような分岐を入れていない
const src = fs.readFileSync(path.join(process.cwd(), "components", "RequestInput.tsx"), "utf-8");
const part = src.slice(src.indexOf("function DemoExamples"), src.indexOf("const when ="));
check("画面に「架空の会話です」と書く", part.includes("架空の会話です"));
check("置き換えの確かめは窓（confirm）を出さない", !/confirm\(|alert\(|window\./.test(part));
check("見せる用でも出す（share・visitor で分けない）", !/share|visitor|SHARE/.test(part) && /mode === "custom" && <DemoExamples/.test(src));

check("例3が押せないときは、ボタンを押せなくして下に一言（aria-describedby でつなぐ）", part.includes("disabled={disabled || !!note}") && part.includes("aria-describedby"));

inboxChecks().then(() => {
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exitCode = failed ? 1 : 0;
});
