// 3タブまわりのテスト（APIを使わない）。
//   npm run test:tabs
// 人の情報（直す・確認済み・Agent は上書きしない・意向とNGのテーマの判定）と、アーカイブ（開催日が過ぎたかの判定）。
// data/people.json には触らない（一時ファイルに書く）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = path.join(os.tmpdir(), `people-test-${Date.now()}.json`);
process.env.PEOPLE_FILE = tmp;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

async function main() {
  const people = await import("../lib/people");
  const { personRuleProblems } = await import("../lib/agent");
  const { validateVenues } = await import("../lib/venues");
  const { getCardById } = await import("../lib/cards");
  const archive = await import("../lib/archive");
  const { employees } = await import("../lib/data");

  // ---- 人の一覧
  const rows = people.peopleRows();
  check("人の一覧は社員全員（カードのない人も出す）", rows.length === employees().length, `${rows.length}人`);
  check("カードのない人もいる", rows.some((r) => r.unpublished_cards === 0));
  check("予定の埋まり具合は計算ができるまで空欄", rows.every((r) => r.load === null));
  const noCard = rows.find((r) => r.unpublished_cards === 0 && !people.personDetail(r.id)!.card_ids.length);
  check("カードのない人の詳細も開ける（最近の活動を出す）", !!noCard && Array.isArray(people.personDetail(noCard.id)!.recent_activities));

  // ---- 人の情報を直す
  const before = people.getPerson("e015")!;
  check("直す前は意向「未確認」・確認済みでない", before.speaking_intent === "unknown" && !before.reviewed);
  const r = people.editPerson("e015", { speaking_intent: "hold", ng_themes: ["決済"], expertise_tags: ["障害対応", "バッチ処理"] });
  check("直すと確認済みになり、直した項目を覚える", r.ok && r.person.reviewed && r.person.edited_fields.length === 3);
  check("得意分野は直したものを使う", people.getPerson("e015")!.expertise_tags.join(",") === "障害対応,バッチ処理");
  check("不正な意向は弾く", !people.editPerson("e015", { speaking_intent: "maybe" as never }).ok);
  check("得意分野を空にはできない", !people.editPerson("e015", { expertise_tags: [] }).ok);
  const auto = people.applyAutoPersonUpdate("e015", { speaking_intent: "available", expertise_tags: ["自動で付けたタグ"] });
  check("Agent・自動処理は人が直した項目を上書きしない", auto.kept.length === 2 && people.getPerson("e015")!.speaking_intent === "hold");
  const auto2 = people.applyAutoPersonUpdate("e016", { speaking_intent: "available" });
  check("人が直していない項目は自動で入れてよい", auto2.kept.length === 0 && people.getPerson("e016")!.speaking_intent === "available");
  check("Agent への人の情報に、意向とNGのテーマが入る", people.peopleNotesForAgent().includes("今は控えたい") && people.peopleNotesForAgent().includes("決済"));

  // ---- 候補を出すときの判定（コード）
  check("「今は控えたい」の人を自信ありで出すと差し戻す", personRuleProblems([{ employee_id: "e015", theme: "障害対応の振り返り", confidence: "strong" }]).length === 1);
  check("「今は控えたい」の人は条件付きなら通る", personRuleProblems([{ employee_id: "e015", theme: "障害対応の振り返り", confidence: "conditional" }]).length === 0);
  check("NGのテーマに当たるテーマ案は差し戻す", personRuleProblems([{ employee_id: "e015", theme: "月末決済バッチのポストモーテム", confidence: "conditional" }]).some((e) => e.includes("NG")));
  const card = getCardById("card-e015-01")!;
  const venue = (theme: string, confidence: "strong" | "conditional") => ({
    summary: "障害の振り返りの取り組みです。",
    no_fit: null,
    venues: [{ event_id: "x002", theme, reason: "インシデント管理がテーマです。", evidence_activity_ids: [card.evidence_activity_ids[0]], cautions: [], confidence, caveat: confidence === "conditional" ? "本人は今は登壇を控えたい意向です。" : null }],
  });
  check("出し先でも「今は控えたい」は条件付きが要る", validateVenues(venue("障害対応の振り返り", "strong"), card).some((e) => e.includes("控えたい")));
  check("出し先でもNGのテーマは差し戻す", validateVenues(venue("決済バッチの障害対応", "conditional"), card).some((e) => e.includes("NG")));

  // ---- アーカイブ（開催日が過ぎたか。今日は 2026-11-21）
  check("本文の年つきの日付を読む", archive.eventDateFromText("【登壇のご相談】○○（2027-01-28 開催、渋谷）", "2026-11-20T00:00:00Z") === "2027-01-28");
  check("「開催」の近くの日付を優先する", archive.eventDateFromText("12/5までにお返事ください。開催は1/28です", "2026-11-20T00:00:00Z") === "2027-01-28");
  check("年がなく受信日より前の月日は翌年とみなす", archive.eventDateFromText("1月28日に開催します", "2026-11-20T00:00:00Z") === "2027-01-28");
  check("日付がなければ読めない（受信箱に残す）", archive.eventDateFromText("どなたか登壇できますか", "2026-11-20T00:00:00Z") === null);
  check("開催日が過ぎた依頼は受信箱から外す", !archive.isActiveInboxItem({ text: "2026-11-10 開催の勉強会", received_at: "2026-10-20T00:00:00Z" }));
  check("開催日が先の依頼は受信箱に残す", archive.isActiveInboxItem({ text: "2027-01-28 開催", received_at: "2026-11-20T00:00:00Z" }));
  check("開催日が今日の依頼はまだ受信箱", archive.isActiveInboxItem({ text: "2026-11-21 開催", received_at: "2026-11-01T00:00:00Z" }));
  const rowsA = archive.archiveRows();
  check("アーカイブに過去のイベントが並ぶ（新しい順）", rowsA.length >= 20 && rowsA[0].date >= rowsA[rowsA.length - 1].date);
  check("サンプルの依頼（開催日が先）はアーカイブに入らない", !rowsA.some((x) => x.kind === "request"));
  const ev = rowsA.find((x) => x.kind === "event")!;
  const d = archive.archiveDetail("event", ev.id)!;
  check("過去のイベントの詳細に日付と登壇者", !!d.date && d.speakers.length > 0, `${d.title}／${d.speakers.join("・")}`);

  fs.rmSync(tmp, { force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(tmp, { force: true });
  process.exit(1);
});
