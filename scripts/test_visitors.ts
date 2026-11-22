// 見せる用を人ごとに分けるテスト（本物の API は使わない・data/ に書き込まない）。
//   npx tsx scripts/test_visitors.ts（npm test にも入る）
// 見るもの：
//   - 見せる用で、visitors/{人}/ の外に書き込みが起きたら落ちる（例外は金額の記録 usage.json の全員の合計だけ）
//   - ある人の操作（カードの修正・却下したテーマ・打診の記録・人の意向と NG・下書き・アンケートの分析と登壇者の記録・
//     ネタ帳の読んだ記録と更新の状態・受信箱・使われた結果・実行の記録）が、ほかの人の候補選びの材料に効かない
//   - 裏の処理（受信箱の準備）は、始めた人の場所に書く（ほかの人の操作の途中でも）
//   - 要求の入口（Next.js の要求の cookie）から人を決める
//   - 初めての人の場所に、サンプルの依頼の保存済みの結果を「準備済み」として入れる
//   - 人の場所の上限と、使われていない場所の片付け
//   - 発表用（SHARE_MODE なし）は今までどおり data/runtime/ だけ
import "./_isolate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

// 見せる用の設定（scripts/serve.mjs の --share と同じ置き方）
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "visitors-"));
const share = path.join(tmp, "runtime-share");
const SHARE_ENV: Record<string, string> = {
  SHARE_MODE: "lan",
  ACCESS_CODE: "test-access-code-123456",
  DATA_RUNTIME_DIR: share,
  INBOX_FILE: path.join(share, "inbox.json"),
  SAMPLE_PROPOSALS_FILE: path.join(share, "sample_proposals.json"),
  DRAFTS_FILE: path.join(share, "drafts.json"),
  TALK_RECORD_FILE: path.join(share, "talk_records.json"),
  PEOPLE_FILE: path.join(share, "people.json"),
  SURVEY_IMPORT_DIR: path.join(share, "survey_imports"),
  USAGE_FILE: path.join(share, "usage.json"),
};
// _isolate が入れた置き場所の設定（SURVEY_ANALYSIS_FILE など）は外す：見せる用の本番と同じく、置き場の中に決めさせる
delete process.env.SURVEY_ANALYSIS_FILE;
Object.assign(process.env, SHARE_ENV);
const DATA = path.join(process.cwd(), "data");
const dataSnapshot = () => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(`${path.relative(DATA, p)}:${fs.statSync(p).size}:${fs.statSync(p).mtimeMs}`);
    }
  };
  walk(DATA);
  return out.sort().join("\n");
};

// ---- すべての書き込みを見張る（fs の書く関数を包む）
type W = { op: string; file: string };
const writes: W[] = [];
const fsm = fs as unknown as Record<string, (...a: unknown[]) => unknown>;
for (const op of ["writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "unlinkSync", "copyFileSync", "utimesSync", "rmdirSync"]) {
  const real = fsm[op].bind(fs);
  fsm[op] = (...a: unknown[]) => {
    writes.push({ op, file: path.resolve(String(op === "copyFileSync" ? a[1] : a[0])) });
    return real(...a);
  };
}
{
  const real = fsm.renameSync.bind(fs);
  fsm.renameSync = (...a: unknown[]) => {
    writes.push({ op: "renameSync", file: path.resolve(String(a[1])) });
    writes.push({ op: "renameSync(from)", file: path.resolve(String(a[0])) });
    return real(...a);
  };
}
const inside = (file: string, dir: string) => {
  const r = path.relative(dir, file);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};
/** 見せる用の決まり：書いてよいのは、その人の場所の中と、金額の記録（全員の合計。①の1人あたりの金額の台帳 person_usage.json も金額の記録）だけ */
function outsideWrites(list: W[], visitorDirPath: string): W[] {
  const money = [path.resolve(SHARE_ENV.USAGE_FILE), path.join(path.resolve(share), "person_usage.json")];
  const isMoney = (f: string) => money.some((m) => f === m || f.startsWith(`${m}.`));
  return list.filter((w) => !inside(w.file, visitorDirPath) && !isMoney(w.file) && !(w.op === "mkdirSync" && inside(visitorDirPath, w.file)));
}

// ---- 偽の AI（アンケートの分析）：キーワードで文を分ける（scripts/test_surveys.ts と同じ）
const BAD = /駆け足|難し|ついていけ|寒|聞き取りにく|遅れ|途切れ|下手|やる気|文字が小さく|速くて|抽象的|分からなかった|共有されて|ほしかった|知りたかった|ほしいです|足りな|浅くて|追いつ/;
const OPS = /寒|マイク|遅れ|配信|質疑/;
const ATTACK = /下手すぎ|やる気が感じられず/;
const OTHER = /ピザ|懇親会|受付|次回も参加/;
const OVERLAP: Record<string, string> = {
  "エージェントの回帰テストをCIで回す方法": "card-e013-01",
  "LLMの出力を自動で評価する仕組み": "card-e013-01",
  "改ざんを検知できる監査ログの作り方": "card-e023-01",
  "flakyなE2Eテストの原因の切り分け方": "card-e020-01",
  "夜間のオンコール呼び出しを減らした話": "card-e016-01",
};

async function main() {
  const vs = await import("../lib/visitorScope");
  const { visitorKey, newVisitorId, VISITOR_COOKIE } = await import("../lib/visitor");
  const { runtimeRoot } = await import("../lib/runtime");
  const inbox = await import("../lib/inbox");
  const cards = await import("../lib/cards");
  const people = await import("../lib/people");
  const board = await import("../lib/board");
  const surveys = await import("../lib/surveys");
  const { surveys: allSurveys } = await import("../lib/surveyCsv");
  const runtime = await import("../lib/runtime");
  const fb = await import("../lib/feedback");
  const trace = await import("../lib/trace");
  const { appendUsage, usage } = await import("../lib/data");
  type AnalysisInput = import("../lib/surveys").AnalysisInput;

  const before = dataSnapshot();
  const A = visitorKey(newVisitorId());
  const B = visitorKey(newVisitorId());
  const dirA = vs.visitorDir(A);
  const dirB = vs.visitorDir(B);

  // ---- 初めての人：サンプルの依頼の保存済みの結果
  const firstView = vs.withVisitor(B, () => ({ root: path.dirname(runtime.runtimeFile("x.json")), d: board.boardDetail("req001"), list: board.boardList() }));
  check("人の場所は <置き場>/visitors/{人}/", firstView.root === dirB && fs.existsSync(dirB), firstView.root);
  check("初めての人：サンプルの依頼に保存済みの結果が「準備済み」で入る", firstView.d?.status === "ready" && (firstView.d?.result?.candidates.length ?? 0) > 0);
  check("「保存済みの結果です。自分の依頼を貼ると本物の AI が動きます」と出す（作業ログの先頭と seeded_note）", firstView.d?.seeded_note === vs.SEED_NOTE && JSON.stringify(firstView.d?.events ?? []).includes(vs.SEED_NOTE));
  const bBefore = vs.withVisitor(B, () => ({
    cards: JSON.stringify(cards.loadCards()),
    people: JSON.stringify(people.allPeople()),
    notebook: JSON.stringify(runtime.readOverlay([], "notebook_state.json")),
    inbox: inbox.listInbox().length,
    analyses: Object.keys(surveys.loadAnalyses()).length,
    talks: surveys.loadTalkRecords().length,
  }));

  // ---- 人 A の操作（見せる用で書くものを一通り）
  writes.length = 0;
  let pendingA: Promise<void> | null = null;
  let releaseRunner: () => void = () => {};
  const gate = new Promise<void>((r) => (releaseRunner = r));
  const sample = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_latest.json"), "utf-8")).rows[0].result;
  await vs.withVisitor(A, async () => {
    // 受信箱：登録して、裏で準備（ここでは待たせておき、B の操作の途中で終わらせる）
    const item = inbox.registerInbox({ text: "12月15日の勉強会で、生成AIの活用について20分話せる方を探しています", source: "manual" });
    pendingA = inbox.prepare(item.id, async (_req, emit) => {
      emit({ type: "tool_call", id: "x", name: "search_cards", input: {} });
      await gate; // B の操作が終わるまで待つ
      emit({ type: "tool_result", id: "x", name: "search_cards", ok: true, summary: "" });
      return { ...sample, run_id: item.id };
    });
    // カードの修正・却下したテーマ・打診の記録
    const c = cards.loadCards().find((x) => x.employee_id === "e001")!;
    const edited = cards.editCard(c.card_id, { summary: "人 A が直したまとめ" });
    check("（準備）人 A のカードの修正ができた", edited.ok, JSON.stringify(edited).slice(0, 200));
    cards.appendOutreach(c.card_id, { request_id: "req001", result: "approved" } as never);
    // 却下したテーマ（AI が足したテーマの候補を、人が却下する）
    cards.patchCard(c.card_id, (x) => ({ ...x, pending_themes: ["人 A が却下するテーマ"] }) as never);
    cards.resolvePendingTheme(c.card_id, "人 A が却下するテーマ", false);
    // 人の意向・NG のテーマ
    const pe = people.editPerson("e002", { ng_themes: ["人 A の NG"], speaking_intent: "hold" });
    check("（準備）人 A の人の意向・NG の修正ができた", pe.ok, JSON.stringify(pe).slice(0, 200));
    // 下書き・サンプルの依頼の候補・開いた印
    board.saveDraft("req001", "e001", { subject: "件名", message: "本文", organizer_reply: null } as never);
    board.saveSampleProposal("req002", sample, [], 0.1);
    board.markSampleOpened("req003");
    // アンケートの分析（偽の AI）→ 分析結果・登壇者の記録・カードへの書き戻し
    const fakeInput = (eventId: string): AnalysisInput => {
      const all = allSurveys();
      const sents = surveys.sentencesOf(eventId, all);
      const sentences = sents.map((s) =>
        OTHER.test(s.text)
          ? { id: s.id, polarity: "good" as const, topic: "operation" as const, attack: false }
          : BAD.test(s.text)
            ? { id: s.id, polarity: "bad" as const, topic: OPS.test(s.text) ? ("operation" as const) : ("content" as const), attack: ATTACK.test(s.text) }
            : { id: s.id, polarity: "good" as const, topic: "content" as const, attack: false },
      );
      const speakers = [...new Set(all.filter((a) => a.event_id === eventId).map((a) => a.talk_speaker_id))];
      const positive_themes: AnalysisInput["positive_themes"] = speakers
        .map((sp) => {
          const ids = sentences.filter((l) => l.polarity === "good" && l.topic === "content" && sents.find((s) => s.id === l.id)!.speaker_id === sp).map((l) => l.id);
          return { speaker_id: sp as string | null, theme: "話の中身が参考になった", sentence_ids: ids, representative_ids: ids.slice(0, 1) };
        })
        .filter((t) => t.sentence_ids.length);
      const eventWide = sentences.filter((l) => l.polarity === "good" && l.topic === "operation").map((l) => l.id);
      if (eventWide.length) positive_themes.push({ speaker_id: null, theme: "懇親会や受付など運営がよかった", sentence_ids: eventWide, representative_ids: eventWide.slice(0, 1) });
      const talks = speakers.map((sp) => {
        const wants = new Map<string, string[]>();
        for (const a of all.filter((x) => x.event_id === eventId && x.talk_speaker_id === sp && x.want_next)) wants.set(a.want_next!, [...(wants.get(a.want_next!) ?? []), a.id]);
        return {
          speaker_id: sp,
          summary: "具体的な話が好評だった",
          content_issue: sentences.some((l) => l.polarity === "bad" && l.topic === "content" && !l.attack && sents.find((s) => s.id === l.id)!.speaker_id === sp) ? "話の分かりにくさ" : null,
          next_themes: [...wants.entries()].map(([text, ids]) => ({ text, response_ids: ids, overlaps_card_id: OVERLAP[text] ?? null })),
        };
      });
      return { sentences, positive_themes, talks };
    };
    const evs: unknown[] = [];
    const analysis = await surveys.analyzeEvent("ev020", (e) => evs.push(e), { analyzer: async () => ({ input: fakeInput("ev020"), content: [], tool_use_id: "t", model: "test" }) });
    check("（準備）人 A のアンケートの分析が保存できた", !!analysis, JSON.stringify(evs.filter((e) => (e as { type: string }).type === "error")).slice(0, 300));
    // ネタ帳の読んだ記録・更新の状態
    runtime.writeOverlay([], "notebook_state.json", { e001: "2026-11-21" });
    runtime.writeOverlay([], "notebook_progress.json", { e001: { at: "2026-11-21" } });
    // 使われた結果・実行の記録・金額の記録
    fb.appendFeedback({ request_id: "req001", target: "candidate", target_id: "e001", verdict: "wrong", reason_code: "busy" });
    await trace.withTrace("req001", () => trace.traceCode("試し", () => 1));
    appendUsage({ at: "2026-11-22T10:00:00+09:00", run_id: "x", purpose: "loop", model: "m", input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cost_usd: 0.01 });
  });

  // アンケート分析の指示文：控えを持たず、今の人のカードから作る（人 A が直した未発信のカードの文が、人 B に渡らない）
  const unpub = vs.withVisitor(A, () => cards.loadCards().find((c) => c.publication_status === "unpublished"))!;
  const sysB0 = vs.withVisitor(B, () => surveys.surveySystem()); // 先に B で作っても、A の分に使い回さない
  vs.withVisitor(A, () => cards.editCard(unpub.card_id, { summary: "人 A だけが直した未発信のまとめ" }));
  const sysA = vs.withVisitor(A, () => surveys.surveySystem());
  const sysB = vs.withVisitor(B, () => surveys.surveySystem());
  check("アンケート分析の指示文：人 A には人 A のカードの文が入る", sysA.includes("人 A だけが直した未発信のまとめ"));
  check("アンケート分析の指示文：人 B には人 A のカードの文が渡らない（控えを使い回さない）", !sysB.includes("人 A だけが直した") && !sysB0.includes("人 A だけが直した"));

  // 人 A の裏の処理が動いている間に、人 B が操作する（B の場所に書く）
  const writesA = writes.splice(0);
  vs.withVisitor(B, () => {
    board.saveDraft("req004", "e003", { subject: "B", message: "B", organizer_reply: null } as never);
    fb.appendFeedback({ request_id: "req004", target: "candidate", target_id: "e003", verdict: "good", reason_code: "good" });
  });
  const writesB = writes.splice(0);
  // ここで A の裏の処理を終わらせる（B の操作のあと、どの人の中でもない所から）
  releaseRunner();
  await pendingA;
  const writesBg = writes.splice(0);

  const outA = outsideWrites(writesA, dirA);
  check("人 A の操作は、すべて visitors/{A}/ の中に書く（例外は金額の記録の合計だけ）", outA.length === 0, outA.map((w) => `${w.op} ${path.relative(tmp, w.file) || w.file}`).slice(0, 8).join("／"));
  const kindsA = new Set(writesA.filter((w) => inside(w.file, dirA)).map((w) => path.basename(w.file).replace(/\.\d+\.\d+\.tmp$/, "").replace(/\.tmp$/, "")));
  const expected = ["inbox.json", "cards.json", "people.json", "drafts.json", "sample_proposals.json", "survey_analysis.json", "talk_records.json", "notebook_state.json", "notebook_progress.json", "feedback.jsonl", "req001.json"];
  const missing = expected.filter((k) => ![...kindsA].some((x) => x.startsWith(k)));
  check("（確かめた書き込み）受信箱・カード・人の意向・下書き・サンプル・分析・登壇者の記録・ネタ帳の記録・使われた結果・実行の記録", missing.length === 0, `足りない：${missing.join(",")}／書いた：${[...kindsA].join(",")}`);
  check("金額の記録（全員の合計）だけは、置き場の usage.json に足す", usage().length === 1 && fs.existsSync(SHARE_ENV.USAGE_FILE) && !fs.existsSync(path.join(dirA, "usage.json")));
  const outB = outsideWrites(writesB, dirB);
  check("人 B の操作は visitors/{B}/ の中に書く", outB.length === 0 && writesB.length > 0, outB.map((w) => w.file).join("／"));
  const outBg = outsideWrites(writesBg, dirA);
  check("裏の処理（人 A の受信箱の準備）は、ほかの人の操作のあとでも人 A の場所に書く", outBg.length === 0 && writesBg.some((w) => inside(w.file, dirA)), outBg.map((w) => path.relative(tmp, w.file)).join("／"));
  const aItems = vs.withVisitor(A, () => inbox.listInbox());
  check("人 A の受信箱の準備が終わって「準備済み」になる", aItems.length === 1 && aItems[0].status === "ready", aItems[0]?.status);

  // ---- ほかの人の候補選びに効かない
  const bAfter = vs.withVisitor(B, () => ({
    cards: JSON.stringify(cards.loadCards()),
    people: JSON.stringify(people.allPeople()),
    notebook: JSON.stringify(runtime.readOverlay([], "notebook_state.json")),
    inbox: inbox.listInbox().length,
    analyses: Object.keys(surveys.loadAnalyses()).length,
    talks: surveys.loadTalkRecords().length,
  }));
  check("人 A のカードの修正・却下・打診の記録・書き戻しは、人 B のネタ帳に出ない", bAfter.cards === bBefore.cards);
  check("人 A の人の意向・NG のテーマは、人 B の人の情報に出ない", bAfter.people === bBefore.people);
  check("人 A のネタ帳の読んだ記録は、人 B に効かない", bAfter.notebook === bBefore.notebook);
  check("人 A の受信箱・分析・登壇者の記録は、人 B に出ない", bAfter.inbox === bBefore.inbox && bAfter.analyses === bBefore.analyses && bAfter.talks === bBefore.talks);
  const aView = vs.withVisitor(A, () => ({ cards: cards.loadCards(), people: people.allPeople() }));
  check("人 A 自身には、自分の操作が出る", aView.cards.some((c) => c.summary === "人 A が直したまとめ") && JSON.stringify(aView.people).includes("人 A の NG"));
  check("元のデータ（data/）には何も書かない", dataSnapshot() === before);

  // ---- 要求の入口：Next.js の要求の cookie から人を決め、裏の処理にも引き継ぐ
  (globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = (await import("node:async_hooks")).AsyncLocalStorage; // Next.js のサーバーが入れるもの
  const { workUnitAsyncStorage } = (await import("next/dist/server/app-render/work-unit-async-storage.external")) as unknown as {
    workUnitAsyncStorage: { run<T>(store: unknown, fn: () => T): T };
  };
  const C_ID = newVisitorId();
  const C = visitorKey(C_ID);
  const fakeStore = { type: "request", cookies: { get: (n: string) => (n === VISITOR_COOKIE ? { name: n, value: C_ID } : undefined) } };
  writes.length = 0;
  let bgC: Promise<void> | null = null;
  const seenC = workUnitAsyncStorage.run(fakeStore, () => {
    const it = inbox.registerInbox({ text: "要求の入口から入った人の依頼です。LTをお願いできる方を探しています", source: "manual" });
    bgC = inbox.prepare(it.id, async () => {
      await new Promise((r) => setTimeout(r, 20));
      return null;
    });
    return vs.currentVisitorKey();
  });
  await bgC;
  check("要求の入口（Next.js の要求の cookie nb_person）から人を決める", seenC === C);
  check("要求から始めた裏の処理も、その人の場所に書く", outsideWrites(writes.splice(0), vs.visitorDir(C)).length === 0 && vs.withVisitor(C, () => inbox.listInbox().length) === 1);
  const noCookie = workUnitAsyncStorage.run({ type: "request", cookies: { get: () => undefined } }, () => vs.currentVisitorKey());
  check("人の印がない要求（合言葉をヘッダーで送るスクリプトなど）は no-person の場所（ほかの人とは分ける）", noCookie === "no-person");
  check("人の名前の形でないものは、フォルダ名に使わない", vs.visitorDir("../../etc") === vs.visitorDir("no-person"));

  // ---- 上限と片付け
  process.env.VISITOR_MAX = "4";
  const now = Date.now() / 1000;
  const age = (key: string, hours: number) => fs.utimesSync(path.join(vs.visitorDir(key), ".last_used"), now - hours * 3600, now - hours * 3600);
  age(B, 30); // 12時間より長く使われていない
  age(A, 1);
  age(C, 2);
  const removedIdle = vs.sweepVisitors();
  check("一定時間（既定12時間）使われていない人の場所は消す", removedIdle.includes(B) && !fs.existsSync(dirB) && fs.existsSync(dirA));
  const extra = [1, 2, 3].map(() => visitorKey(newVisitorId()));
  for (const k of extra) vs.withVisitor(k, () => runtime.runtimeFile("x.json"));
  const keys = vs.listVisitors().map((v) => v.key);
  check("上限（VISITOR_MAX）を超えたら、いちばん長く使われていない場所から消す", keys.length <= 4 && !keys.includes(C) && extra.every((k) => keys.includes(k)), `${keys.length}人`);
  delete process.env.VISITOR_MAX;
  check("上限の既定は200人", vs.visitorMax() === 200);

  // ---- 発表用（SHARE_MODE なし）は今までどおり
  for (const k of Object.keys(SHARE_ENV)) delete process.env[k];
  const rt = path.join(tmp, "runtime-local");
  process.env.DATA_RUNTIME_DIR = rt;
  check("発表用：人ごとに分けない（data/runtime/ だけ）", runtimeRoot() === rt && vs.currentVisitorKey() === null && !fs.existsSync(path.join(rt, "visitors")));
  process.env.INBOX_FILE = path.join(tmp, "inbox-local.json");
  inbox.registerInbox({ text: "発表用の依頼です。登壇をお願いできる方を探しています", source: "manual" });
  check("発表用：受信箱は今までどおりの場所", fs.existsSync(path.join(tmp, "inbox-local.json")));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(1);
});
