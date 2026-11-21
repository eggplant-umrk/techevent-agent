// 「ネタ帳を更新」の前処理のテスト（APIは使わない・data/ に書き込まない）。
//   npm run test:notebook
// 見るもの：コードで落とす（共通・GitHub）／件数と文字数の上限と次回送り／前回より新しい活動だけ（今までの日付の記録からの引き継ぎ）／
//           金額の見積もりと、上限を超えたら API を呼ばずに止まること／保存の前の重複カードの検査
import fs from "node:fs";
import path from "node:path";
import type { Activity } from "../lib/data";
import type { Card } from "../lib/cards";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

const act = (id: string, date: string, title: string, body: string, extra: Partial<Activity> & { url?: string } = {}): Activity =>
  ({ id, type: "slack_post", author_id: "e999", date, title, body, channel: "#dev", ...extra }) as Activity;

async function main() {
  delete process.env.DEMO_PERSON;
  delete process.env.ANTHROPIC_API_KEY; // API を呼ぼうとしたら落ちるように
  for (const k of ["NOTEBOOK_MAX_ITEMS", "NOTEBOOK_MAX_CHARS", "NOTEBOOK_BODY_CHARS", "NOTEBOOK_BUDGET_USD"]) delete process.env[k];
  process.env.DATA_SOURCE = "stress";
  const prep = await import("../lib/notebookPrep");
  const { classify, filterActivities, capActivities, prepareEmployee, duplicateCardProblem, estimateUsd, prepConfig, countReasons } = prep;

  // ---- 共通の落とし方 ----
  const long = "検索の遅い問い合わせを見直して、インデックスを足したら応答が半分になった";
  check("極端に短い投稿は落とす", classify(act("a1", "2026-10-01", "週報", "了解です")).reason === "too_short");
  check("「特になし」は定型文として落とす", classify(act("a2", "2026-10-01", "週報", "特になし。")).reason === "boilerplate");
  check("中身のある投稿は残す", classify(act("a3", "2026-10-01", "検索の改善", long)).reason === null);
  const dup = filterActivities([
    act("b1", "2026-10-01", "検索の改善", long),
    act("b2", "2026-10-02", "検索の改善", `  ${long}  `),
    act("b3", "2026-10-03", "週報", long.replace("半分", "半分")), // 本文が同じ
    act("b4", "2026-10-04", "検索の改善（続き）", "同じ見直しを2件目の問い合わせにも当てて、応答が3割速くなった"),
  ]);
  check("同じ本文の重複は最初の1件だけ残す", dup.kept.map((a) => a.id).join(",") === "b1,b4" && dup.dropped.every((d) => d.reason === "duplicate"), `残す ${dup.kept.map((a) => a.id)}`);
  const nums = filterActivities([act("c1", "2026-10-01", "アラート", "今週のアラートは5件で、対応が必要なのは2件だった"), act("c2", "2026-10-08", "アラート", "今週のアラートは7件で、対応が必要なのは1件だった")]);
  check("数字だけ違う進み具合の報告は、重複にしない", nums.kept.length === 2);
  const seen = new Set<string>();
  filterActivities([act("d1", "2026-09-01", "検索の改善", long)], seen);
  check("前回までに読んだ本文と同じものは、新しい活動でも落とす", filterActivities([act("d2", "2026-10-01", "検索の改善", long)], seen).dropped[0]?.reason === "duplicate");

  // ---- GitHub の落とし方 ----
  const pr = (id: string, body: string, title = "repo：検索のインデックスを足す") => act(id, "2026-10-01", title, body, { type: "github_pr", channel: undefined, repo: "repo", url: `https://github.com/x/repo/pull/${id}` } as Partial<Activity>);
  check("マージされていない PR は落とす", classify(pr("p1", "レビュー中 ／ 検索のインデックスを足して、遅い問い合わせを直す")).reason === "unmerged_pr");
  check("説明がほとんどない PR は落とす", classify(pr("p2", "マージ 2026-10-01 ／ 検索のインデックスを足す")).reason === "thin_pr");
  check("説明のあるマージ済みの PR は残す", classify(pr("p3", "マージ 2026-10-01 ／ 遅い問い合わせ3本にインデックスを足し、応答を半分にした。計測は README に")).reason === null);
  const commits = (id: string, msgs: string[]) =>
    act(id, "2026-10-02", "repo：この日のコミット", `この日のコミット${msgs.length}件：${msgs.join(" ／ ")}`, { type: "github_pr", channel: undefined, repo: "repo", url: "https://github.com/x/repo/commits/main?since=2026-10-02" } as Partial<Activity>);
  check("ボットだけのコミットは落とす", classify(commits("m1", ["Merge pull request #3 from x/y", "Bump next from 15.0 to 15.1"])).reason === "bot");
  check("typo・依存の更新だけのコミットは落とす", classify(commits("m2", ["typo", "依存の更新", "prettier をかけた"])).reason === "trivial_commit");
  const mixed = classify(commits("m3", ["typo", "検索の結果を日付でまとめて表示する", "Bump next from 15.0 to 15.1"]));
  check("まとめのうち中身のあるコミットだけを残す", mixed.reason === null && mixed.body === "この日のコミット3件のうち1件：検索の結果を日付でまとめて表示する", mixed.body);

  const github = JSON.parse(fs.readFileSync(path.join("data", "sources", "github", "activities.json"), "utf-8")) as Activity[];
  const gh = filterActivities(github);
  const ghChars = (xs: Activity[]) => xs.reduce((n, a) => n + a.title.length + a.body.length, 0);
  check(
    "本物の GitHub の活動：一部を落とし、大半は残す",
    gh.dropped.length > 0 && gh.kept.length > github.length / 2,
    `${github.length}件 → 残す${gh.kept.length}件・落とす${gh.dropped.length}件 ${JSON.stringify(countReasons(gh.dropped))}／${ghChars(github)}字 → ${ghChars(gh.kept)}字`,
  );

  // ---- 上限と次回送り ----
  const many = Array.from({ length: 30 }, (_, i) => act(`k${String(i).padStart(2, "0")}`, `2026-10-${String(i + 1).padStart(2, "0")}`, `取り組み${i}`, `取り組み${i}について、手順を見直して計測した結果をまとめた。` + "あ".repeat(i === 29 ? 1000 : 50)));
  const cap = capActivities(many, { maxItems: 10, maxChars: 100000, bodyChars: 200, budgetUsd: 1 });
  check("件数の上限：新しい順に詰め、古いものは次回に回す", cap.send.length === 10 && cap.deferred.length === 20 && cap.send[9].id === "k29" && cap.deferred.every((a) => a.id < "k20"), `渡す ${cap.send[0].id}〜${cap.send[9].id}`);
  check("渡すときは古い順に並べる", cap.send.every((a, i) => i === 0 || cap.send[i - 1].date <= a.date));
  check("長い本文は先頭だけにする", cap.send[9].body.length === 201 && cap.send[9].body.endsWith("…"));
  const capChars = capActivities(many, { maxItems: 100, maxChars: 1000, bodyChars: 200, budgetUsd: 1 });
  const sentChars = capChars.send.reduce((n, a) => n + prep.activityChars(a, 200), 0);
  check("文字数の上限を超えない", sentChars <= 1000 && capChars.deferred.length > 0, `${capChars.send.length}件・${sentChars}字`);

  // ---- 前回より新しい活動だけ ----
  const stressActs = (await import("../lib/data")).activities();
  const e013 = stressActs.filter((a) => a.author_id === "e013");
  const progressFile = path.join("data", "sources", "stress", "notebook_progress.json");
  check("（前提）stress には読んだ記録のファイルがない", !fs.existsSync(progressFile));
  const first = prepareEmployee("e013", stressActs, undefined);
  check(
    "初回：全部が新しい活動で、渡す＋落とす＋次回送り＝新しい活動",
    first.fresh === e013.length && first.send.length + first.dropped.length + first.deferred.length === first.fresh,
    `${first.fresh}件 → 渡す${first.send.length}・落とす${first.dropped.length} ${JSON.stringify(countReasons(first.dropped))}・次回${first.deferred.length}`,
  );
  const mid = [...e013].sort((a, b) => (a.date < b.date ? -1 : 1))[Math.floor(e013.length / 2)].date;
  const later = prepareEmployee("e013", stressActs, mid);
  check(
    "今までの日付の記録があれば、その日までは読んだものとして引き継ぐ（新しい分だけ）",
    later.fresh === e013.filter((a) => a.date > mid).length && later.send.every((a) => a.date > mid),
    `${mid} より後 ${later.fresh}件`,
  );
  const all = prepareEmployee("e013", stressActs, "9999-12-31");
  check("全部読んだあとは、渡すものがない", all.fresh === 0 && all.send.length === 0);

  // ---- 金額の見積もりと予算 ----
  const cfg = prepConfig();
  check("予算の既定は $1（.env に NOTEBOOK_BUDGET_USD がなければ）", cfg.budgetUsd === 1);
  const est = estimateUsd("claude-opus-5-5", 42000, 128, 16000, true);
  check("見積もり：本物の GitHub 1人分（4.2万字・128件）が実測 $0.28〜0.30 に近い", est > 0.2 && est < 0.4, `$${est.toFixed(3)}`);

  const { updateNotebook } = await import("../lib/notebook");
  const cardsFile = path.join("data", "sources", "stress", "cards.json");
  const stateFile = path.join("data", "sources", "stress", "notebook_state.json");
  const before = [fs.readFileSync(cardsFile), fs.readFileSync(stateFile)];
  process.env.NOTEBOOK_BUDGET_USD = "0.001";
  const events: Array<{ type: string; [k: string]: unknown }> = [];
  let threw = "";
  try {
    await updateNotebook(["e013", "e015"], (e) => events.push(e as never));
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  const budget = events.find((e) => e.type === "budget");
  check("予算を超える見積もりなら、API を呼ばずに理由を返して止まる", !threw && !!budget && budget.ok === false && events.some((e) => e.type === "error") && events.at(-1)?.type === "done" && !events.some((e) => e.type === "employee"), threw || String(budget?.message));
  check("止まったときは、カード・状態・読んだ記録を書き換えない", fs.readFileSync(cardsFile).equals(before[0]) && fs.readFileSync(stateFile).equals(before[1]) && !fs.existsSync(progressFile));
  delete process.env.NOTEBOOK_BUDGET_USD;

  // ---- 重複カードの検査 ----
  const card = (id: string, theme: string, summary: string, ev: string[], eid = "e013") =>
    ({ card_id: id, employee_id: eid, themes: [theme], summary, evidence_activity_ids: ev, announcement_activity_ids: [], published_ids: [], reviewed: false }) as unknown as Card;
  const existing = [card("c-1", "問い合わせ検索の高速化", "遅い問い合わせにインデックスを足して、応答時間を半分にした", ["act1", "act2"])];
  const input = (themes: string[], summary: string, ev: string[], card_id: string | null = null, employee_id = "e013") =>
    ({ card_id, employee_id, themes, summary, evidence_activity_ids: ev }) as never;
  check("根拠が重なる新しいカードは差し戻す", !!duplicateCardProblem(input(["別の名前"], "別の話", ["act2", "act9"]), existing));
  check("テーマが近い新しいカードは差し戻す（card_id を指定するよう伝える）", (duplicateCardProblem(input(["問い合わせ検索の高速化（続き）"], "続きの話", ["act9"]), existing) ?? "").includes('card_id: "c-1"'));
  check("card_id を指定した更新は通す", duplicateCardProblem(input(["問い合わせ検索の高速化"], "続き", ["act2"], "c-1"), existing) === null);
  check("別の取り組みは通す", duplicateCardProblem(input(["社内勉強会の運営"], "月1回の勉強会を立ち上げ、参加者が倍になった", ["act9"]), existing) === null);
  check("別の人のカードとは比べない", duplicateCardProblem(input(["問い合わせ検索の高速化"], "同じ名前", ["act1"], null, "e015"), existing) === null);

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて通りました");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
