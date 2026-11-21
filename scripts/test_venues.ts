// カード → 出し先 のテスト（APIを使わない）。
//   npm run test:venues
// 外部イベントの検索、締切の判定、必ず付ける注意点、提出の検証（コード）を確かめる。
import "./_isolate"; // 元のデータだけで動かす（実行時のデータ data/runtime/ は読まない・書かない）
import { getCardById } from "../lib/cards";
import { isClosed, requiredCautions, searchExternalEvents, externalEventById, type ExternalEvent } from "../lib/externalEvents";
import { validateVenues, type VenueSubmit } from "../lib/venues";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

// ---- 検索（ファイルを読むだけ）
const sec = searchExternalEvents({ query: "セキュリティ" });
const secIds = sec.results.map((r) => r.id);
check("テーマの言葉で探せる（セキュリティ）", secIds.includes("x004") && secIds.includes("x008"), secIds.join(","));
check("締切済みは can_apply=false で返す", sec.results.find((r) => r.id === "x007")?.can_apply === false);
const period = searchExternalEvents({ query: "", from: "2027-02-15", to: "2027-02-28" });
check("期間で絞れる（開催日が未定のものは残す）", period.results.every((r) => !r.event_date || (r.event_date >= "2027-02-15" && r.event_date <= "2027-02-28")) && period.results.some((r) => r.event_date === null));

// ---- 締切の判定
const ev = (id: string) => externalEventById(id)!;
check("closed は締切済み", isClosed(ev("x005")));
check("open で締切前は応募できる", !isClosed(ev("x001")));
const past: ExternalEvent = { ...ev("x001"), cfp_status: "open", cfp_deadline: "2026-11-20T23:59:00+09:00" };
check("締切が今日より前なら締切済み", isClosed(past));
const todayEnd: ExternalEvent = { ...ev("x001"), cfp_status: "open", cfp_deadline: "2026-11-21T23:59:00+09:00" };
check("締切が今日ならまだ応募できる", !isClosed(todayEnd));

// ---- 必ず付ける注意点
check("unknown には「締切は公式で要確認」", requiredCautions(ev("x002"), null).includes("締切は公式で要確認"));
check("開催日が未定なら「開催日は要確認」", requiredCautions(ev("x001"), null).includes("開催日は要確認"));
const near: ExternalEvent = { ...ev("x001"), cfp_deadline: "2026-11-30T23:59:00+09:00" };
check("締切が14日以内なら「締切が近い」", requiredCautions(near, null).some((c) => c.startsWith("締切が近い")), requiredCautions(near, null).join("／"));
check("締切に余裕があれば「締切が近い」は付けない", !requiredCautions(ev("x001"), null).some((c) => c.startsWith("締切が近い")));
const overlap = requiredCautions(ev("x003"), "e009");
check("本人の予定が開催日の前後3日に重なれば書く", overlap.some((c) => c.startsWith("本人の予定が重なる")), overlap.join("／"));

// ---- 提出の検証（コード）
const card = getCardById("card-e024-01")!;
const base = (over: Partial<VenueSubmit["venues"][number]>): VenueSubmit => ({
  summary: "脆弱性アラートの自動振り分けの取り組みです。",
  no_fit: null,
  venues: [
    {
      event_id: "x004",
      theme: "脆弱性アラートを月400件から50件に減らした自動トリアージ",
      reason: "自作ツールと技術調査のテーマに合います。",
      evidence_activity_ids: [card.evidence_activity_ids[0]],
      cautions: [],
      confidence: "strong",
      caveat: null,
      ...over,
    },
  ],
});
check("正しい提出は通る", validateVenues(base({}), card).length === 0, validateVenues(base({}), card).join("／"));
check("締切済み（closed）は弾く", validateVenues(base({ event_id: "x007" }), card).some((e) => e.includes("締切済み")));
check("存在しないイベントidは弾く", validateVenues(base({ event_id: "x999" }), card).some((e) => e.includes("存在しません")));
check("カードの根拠でないidは弾く", validateVenues(base({ evidence_activity_ids: ["act001"] }), card).some((e) => e.includes("このカードの根拠ではありません")));
check("内部の言葉は弾く", validateVenues(base({ reason: "card-e024-01 の reviewed=false なネタ" }), card).some((e) => e.includes("内部")));
check("開催日と食い違う日付は弾く", validateVenues(base({ cautions: ["開催日 2027-03-02 は空いている"] }), card).some((e) => e.includes("開催日")));
check("条件付きには引っかかる点が要る", validateVenues(base({ confidence: "conditional", caveat: null }), card).some((e) => e.includes("caveat")));
check("1件もないなら見つからない理由が要る", validateVenues({ summary: "なし", no_fit: null, venues: [] }, card).length > 0);
check("1件もなく理由があれば通る", validateVenues({ summary: "なし", no_fit: { reasons: ["合うイベントがありません"], next_checks: ["来月もう一度探す"] }, venues: [] }, card).length === 0);

console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
process.exitCode = failed ? 1 : 0;
