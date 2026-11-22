// サーバーの起動時の片付け（instrumentation.ts から、Node.js で動くときだけ読む）。
// 前のサーバーで「候補を準備中」のまま止まった受信箱の依頼を「エラー（途中で止まりました）」にして、押し直せるようにする。
// 見せる用（SHARE_MODE=lan）では、人ごとの置き場所（visitors/{人}/）の受信箱をそれぞれ直す（使った時刻は変えない）。
import { recoverInterrupted } from "./lib/inbox";
import { forEachVisitorQuietly, visitorsOn } from "./lib/visitorScope";

export function startupCleanup(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return; // ビルドのときは触らない
  try {
    const n = visitorsOn() ? forEachVisitorQuietly(() => recoverInterrupted()).reduce((t, r) => t + r.value, 0) : recoverInterrupted();
    if (n) console.log(`[起動時の片付け] 受信箱で途中のまま止まっていたもの ${n}件（候補づくり・代わりの人を推す文）を、エラーにして押し直せるようにしました`);
  } catch (e) {
    // 片付けに失敗しても起動は止めない（受信箱は今までどおり15分で「途中で止まりました」になる）
    console.error(`[起動時の片付け] できませんでした（${e instanceof Error ? e.message : "不明なエラー"}）`);
  }
}

startupCleanup();
