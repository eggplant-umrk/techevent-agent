// リリースノートの取り込み・担当者の決め方・担当者未定のネタのテスト（APIは使わない）。
//   npm run test:release
// data/cards.json は最後にバイトごと元に戻す。担当者の記録と担当者未定のネタは一時ファイルに書く。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "release-test-"));
process.env.RELEASE_OWNERS_FILE = path.join(tmpDir, "owners.json");
process.env.UNASSIGNED_CARDS_FILE = path.join(tmpDir, "unassigned.json");
delete process.env.DATA_SOURCE;
delete process.env.DEMO_PERSON;
delete process.env.RELEASE_NOTES;

const CARDS = path.join(process.cwd(), "data", "cards.json");
const original = fs.readFileSync(CARDS);

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

async function main() {
  const { activities, notebookActivities } = await import("../lib/data");
  const { loadCards } = await import("../lib/cards");
  const { internalTerms } = await import("../lib/plainText");
  const rn = await import("../lib/releaseNotes");
  const rc = await import("../lib/releaseCards");
  const { validateSubmit } = await import("../lib/agent");
  const { executeTool } = await import("../lib/tools");

  // いつも同じ出発点にする：リリースノートから作ったカードを一時的に外す（最後に cards.json はバイトごと元に戻す）
  const startCards = (JSON.parse(original.toString("utf-8")) as Array<{ evidence_activity_ids: string[] }>).filter(
    (c) => !c.evidence_activity_ids.some((id) => id.startsWith("rel")),
  );
  fs.writeFileSync(CARDS, JSON.stringify(startCards, null, 2) + "\n");
  check("出発点：リリースノートは10件ともまだカードになっていない", rc.pendingReleaseNotes().length === 10);

  // ---- 取り込み
  const notes = rn.releaseNotes();
  const acts = activities();
  const rel = acts.filter((a) => a.type === "release_note");
  check("リリースノート10件が活動（release_note）として入る", notes.length === 10 && rel.length === 10);
  check("各活動に公開ページの URL がある", rel.every((a) => /^https:\/\/bakuraku\.jp\/news\/\d+/.test(a.url ?? "")));
  check("担当者が書いてあるものは、その人の活動になる", rel.filter((a) => a.author_id).every((a) => notes.find((n) => n.id === a.id)?.owner_id === a.author_id));
  const noOwner = notes.filter((n) => !n.owner_id).map((n) => n.id);
  check("担当者なしのリリースは3件で、活動の担当者は空（推測で埋めない）", noOwner.length === 3 && rel.filter((a) => noOwner.includes(a.id)).every((a) => a.author_id === ""), noOwner.join(","));
  check("id は架空の活動（act…）とぶつからない", new Set(acts.map((a) => a.id)).size === acts.length);
  check("ネタ帳の更新（社員ごと）にはリリースノートを入れない（別の流れで読む）", notebookActivities().every((a) => a.type !== "release_note"));
  check("要約は原文の写しではなく2〜3文（120〜200字ほど）", notes.every((n) => n.summary.length >= 60 && n.summary.length <= 220 && n.summary.split("。").filter(Boolean).length <= 3));
  check("担当者未定のリリースは、検索結果で「担当者未定」と出る", (() => {
    const r = executeTool("search_activities", { query: "契約管理 台帳" }).result as { results: Array<{ id: string; author: string }> };
    return r.results.some((x) => x.id === "rel003" && x.author === "担当者未定");
  })());
  check("内部の言葉の判定が rel001 を見つける", internalTerms("rel001 のリリース").length > 0);

  process.env.RELEASE_NOTES = "off";
  check("RELEASE_NOTES=off なら入れない（評価は今までどおりの材料）", activities().every((a) => a.type !== "release_note"));
  delete process.env.RELEASE_NOTES;
  process.env.DATA_SOURCE = "github";
  check("DATA_SOURCE=github（本人だけ）のときは入れない", rn.releaseNotes().length === 0);
  delete process.env.DATA_SOURCE;

  // ---- 同じ機能に触れている活動を探す（キーワード一致）
  const rel004 = notes.find((n) => n.id === "rel004")!;
  const fake = [
    { id: "act901", type: "github_pr" as const, author_id: "e018", date: "2026-08-01", title: "年末調整の源泉徴収票をOCRで読み取る", body: "控除証明書の読み取り精度を上げた", channel: null, repo: null },
    { id: "act902", type: "slack_post" as const, author_id: "e025", date: "2026-08-01", title: "ランチ会", body: "AIの話をしました", channel: null, repo: null },
  ];
  const cands = rn.ownerCandidates(rel004, fake);
  check("同じ機能の言葉が2つ以上一致した人だけを候補にする", cands.length === 1 && cands[0].employee_id === "e018" && cands[0].activity_ids[0] === "act901", JSON.stringify(cands.map((c) => c.matched_keywords)));
  check("一般的な言葉（AIなど）だけの一致は候補にしない", !cands.some((c) => c.employee_id === "e025"));
  check("今のデータでは担当者なしの3件に候補はいない（架空の活動はこの製品に触れていない）", rc.pendingReleaseNotes().filter((p) => !p.owner).every((p) => p.candidates.length === 0));

  // ---- AI の判断をコードで確かめる
  check("候補の外の人は認めない", rn.checkMatch(cands, { employee_id: "e011", evidence_activity_ids: ["act901"] }).length > 0);
  check("根拠の活動がなければ認めない", rn.checkMatch(cands, { employee_id: "e018", evidence_activity_ids: [] }).length > 0);
  check("一致していない活動を根拠にしたら認めない", rn.checkMatch(cands, { employee_id: "e018", evidence_activity_ids: ["act064"] }).length > 0);
  check("候補の人を、一致した活動を根拠に選ぶのは認める", rn.checkMatch(cands, { employee_id: "e018", evidence_activity_ids: ["act901"] }).length === 0);
  check("決めない（null）はいつでも認める", rn.checkMatch(cands, { employee_id: null, evidence_activity_ids: [] }).length === 0);

  // ---- 提出の検査
  const pending = rc.pendingReleaseNotes();
  const item = (id: string, over: Record<string, unknown> = {}) => ({
    release_id: id,
    summary: "リリースで何を出し、誰のどんな課題を解いたかの要約です。",
    themes: ["課題の見つけ方と、AIに任せる範囲の決め方"],
    format: "lt" as const,
    format_reason: "1つの判断に絞って話せるため",
    owner: { employee_id: null, evidence_activity_ids: [], reason: "" },
    ...over,
  });
  const all = pending.map((p) => item(p.note.id));
  check("全部のリリースノートの中身があれば通る", rc.validateReleaseSubmit(all, pending).length === 0, rc.validateReleaseSubmit(all, pending).join(" / "));
  check("1件でも欠けたら差し戻す", rc.validateReleaseSubmit(all.slice(1), pending).length > 0);
  check("担当者が決まっているものに別の人を付けたら差し戻す", rc.validateReleaseSubmit([...all.filter((x) => x.release_id !== "rel001"), item("rel001", { owner: { employee_id: "e002", evidence_activity_ids: [], reason: "" } })], pending).length > 0);
  check("候補のないものに人を付けたら差し戻す（推測で決めない）", rc.validateReleaseSubmit([...all.filter((x) => x.release_id !== "rel003"), item("rel003", { owner: { employee_id: "e011", evidence_activity_ids: ["act001"], reason: "" } })], pending).length > 0);
  check("文に内部の id があれば差し戻す", rc.validateReleaseSubmit([...all.filter((x) => x.release_id !== "rel002"), item("rel002", { summary: "rel002 を出した" })], pending).length > 0);

  // ---- 保存（既存のカードは上書きしない）
  const before = loadCards();
  const out = rc.saveReleaseItems(all, pending);
  const after = loadCards();
  check("担当者が分かる7件は、その人の新しいカードになる", out.cards === 7 && after.length === before.length + 7);
  check("既存のカードは1枚も変わらない", JSON.stringify(after.slice(0, before.length)) === JSON.stringify(before));
  const newCards = after.slice(before.length);
  check("新しいカードの根拠はリリースノートの id（担当者本人の活動）", newCards.every((c) => c.evidence_activity_ids.length === 1 && c.evidence_activity_ids[0].startsWith("rel") && acts.find((a) => a.id === c.evidence_activity_ids[0])?.author_id === c.employee_id));
  check("リリースノートは「発信済み」ではない（未発信・発信の記録なし）", newCards.every((c) => c.publication_status === "unpublished" && c.published_ids.length === 0 && c.announcement_activity_ids.length === 0));
  const un = rn.unassignedCards();
  check("担当者が決まらない3件は「担当者未定のネタ」（担当者は null）", out.unassigned === 3 && un.length === 3 && un.every((c) => c.employee_id === null));
  check("担当者未定のネタは、カード（候補の検索の対象）には入らない", !after.some((c) => c.evidence_activity_ids.some((id) => noOwner.includes(id))));
  check("search_cards にも出ない", !(JSON.stringify(executeTool("search_cards", { query: "契約管理 人事労務 AIトークン" }).result).includes("card-team")));
  check("もう一度流しても、カードになったものは読まない", rc.pendingReleaseNotes().length === 0);

  // ---- 提案の検査：担当者未定のリリースを人の根拠にしない
  const seen = new Set(["rel003"]);
  const errs = validateSubmit(
    {
      request_pattern: "theme_specified",
      summary: "テスト",
      nominee_assessment: null,
      learnings_applied: [],
      no_fit: null,
      candidates: [{ employee_id: "e011", card_id: null, theme: "契約管理", reason: "テスト", evidence_activity_ids: ["rel003"], cautions: [], is_alternative_to_nominee: false, confidence: "strong", caveat: null }],
    } as never,
    seen,
    null,
    { id: "req002" } as never,
  );
  check("担当者が決まっていないリリースは、候補の根拠に使えない", errs.some((e) => e.includes("rel003")), errs.find((e) => e.includes("rel003")));

  // ---- 窓口：一覧と割り当て
  const list = rc.listUnassigned();
  check("一覧に、リリースノートのタイトルと公開ページの URL が付く", list.length === 3 && list.every((c) => c.release_notes[0].url.startsWith("https://bakuraku.jp/news/")));
  check("いない社員には割り当てられない", !rc.assignUnassigned(un[0].card_id, "e999").ok && rn.unassignedCards().length === 3);
  const assigned = rc.assignUnassigned(un[0].card_id, "e011");
  const card = loadCards().find((c) => c.card_id === assigned.card_id);
  check("割り当てたら、その人の普通のカードになる", assigned.ok && card?.employee_id === "e011" && card.evidence_activity_ids[0] === un[0].release_note_ids[0], assigned.card_id);
  check("割り当てたカードは確認済み（Agent は上書きしない）", card?.reviewed === true && !!card.reviewed_at);
  check("担当者未定のネタからは外れる", rn.unassignedCards().length === 2 && !rn.unassignedCards().some((c) => c.card_id === un[0].card_id));
  check("割り当ては技術広報の割り当てとして残り、リリースの活動の担当者になる", rn.ownerRecords()[un[0].release_note_ids[0]]?.by === "human" && activities().find((a) => a.id === un[0].release_note_ids[0])?.author_id === "e011");
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(() => {
    fs.writeFileSync(CARDS, original);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
    process.exit(failed ? 1 : 0);
  });
