import "./_isolate"; // 元のデータだけで動かす（今日は FIXED_TODAY=2026-11-21）
// 依頼 → 候補の準備を速くするための前処理・後処理のテスト（APIは使わない）。
//   npm run test:prep
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

async function main() {
  const { requests } = await import("../lib/data");
  const p = await import("../lib/proposalPrep");
  const reqs = new Map(requests().map((r) => [r.id, r]));

  // ---- 最初の検索
  const q2 = p.prefetchQuery(reqs.get("req002")!);
  check("テーマ指定の依頼は、テーマの言葉で検索する", q2.length > 0 && !/勉強会|meetup/i.test(q2), q2);
  check("枠だけの依頼は、言葉なし（未発信のカードを新しい順）", p.prefetchQuery(reqs.get("req001")!) === "");
  const expect: Record<string, string> = { req002: "e013", req003: "e015", req004: "e012", req005: "e024" };
  for (const [id, who] of Object.entries(expect)) {
    const pre = p.prefetchForAgent(reqs.get(id)!);
    check(`${id}：先に調べた候補に想定の人（${who}）が入る`, pre.text.includes(`｜${who} `), `「${pre.query}」`);
  }
  const pre4 = p.prefetchForAgent(reqs.get("req004")!);
  check("指名の依頼は、指名された本人のカードも入れる", pre4.text.includes("｜e002 "));
  const actIds = new Set((await import("../lib/data")).activities().map((a) => a.id));
  check("見せたカードの根拠の id（実在する活動）を、根拠に使ってよい id として渡す", pre4.seen.length > 0 && pre4.seen.every((x) => actIds.has(x)));
  const pre1 = p.prefetchForAgent(reqs.get("req001")!);
  check("枠だけの依頼でも候補を渡す（未発信のカード）", pre1.text.includes("未発信のカードを新しい順に") && pre1.seen.length > 0);
  check("先に調べた候補は8枚まで（＋指名された本人）", (pre1.text.match(/^- card-/gm) ?? []).length <= 8);

  // ---- コードで出す注意点
  const r4 = reqs.get("req004")!; // 開催 2027-01-28、e002 はオフサイトと重なる
  const c002 = p.computedCautions("e002", r4, "card-e002-01");
  check("予定が詰まっている人には、予定の埋まりをコードが足す", c002.some((x) => x.startsWith("今後2週間")), c002.join("／"));
  check("予定が重なる人には、重なる予定をコードが足す", c002.some((x) => x.startsWith("予定が重なる（オフサイト")));
  const c012 = p.computedCautions("e012", r4, "card-e012-01");
  check("余裕のある人には、予定の埋まりを足さない", !c012.some((x) => x.startsWith("今後2週間")), c012.join("／"));
  check("未確認のカードには、そのことをコードが足す", c012.includes("ネタ帳の記録は技術広報が未確認"));
  const undecided = p.computedCautions("e012", { ...r4, event: undefined, intake: undefined } as never, null);
  check("日程が未定なら、そのことをコードが足す", undecided.includes("日程が未定なので、予定が重ならないかは日程が決まったら確認"));

  // ---- Agent が書いた、コードと同じことだけの注意点は除く
  const agent = [
    "今後2週間は勤務時間の7割が予定で埋まっている",
    "開催日の前後3日に予定の重なりはなし",
    "予定は不明",
    "日程が未定なので、予定が重ならないかは日程が決まったら確認",
    "ネタ帳の記録は技術広報が未確認",
    "テーマが少しずれる（障害の振り返りではなくオンコール改善）",
    "金融の障害事例なので、社外に出してよい範囲の確認が要る",
  ];
  const kept = p.dropComputableCautions(agent);
  check("コードで出せる注意点は除き、ほかは残す", JSON.stringify(kept) === JSON.stringify(agent.slice(5)), kept.join("／"));

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
