// デモの前に、元のデータだけの初期状態に戻す（npm run reset:demo）。API は使わない。
//   - 実行時のデータ（data/runtime/：打診・承諾の記録、カードの編集、割り当て、ネタ帳の更新の結果など）と、
//     画面の操作の記録（受信箱 data/inbox.json、サンプルの依頼の結果、下書き、登壇の記録）を片付ける
//   - 消さずに data/runtime-backup/<日時>/ に移す（必要なら戻せる）。--delete を付けると消す
//   - 元のデータ（git に入っている data/ のファイル）・金額の記録（data/usage.json）・アンケートの分析結果は触らない
//   - 保存したカレンダー（data/runtime/calendar_cache.json）は残す。デモの操作の記録ではなく、
//     消すと発表の直前に Google へ取りに行くことになり、そこで断られる（429）と本人の予定が「不明」になるため。
//     --calendar を付けると、これも片付ける（URL を差し替えたときは自動で使わなくなるので、普通は要らない）
//   - 開発サーバーが動いていると、画面に前の状態が残ることがある。片付けたあとは画面を読み込み直す
import fs from "node:fs";
import path from "node:path";
import { resetTargets, runtimeRoot } from "../lib/runtime";
import { CALENDAR_CACHE_NAME } from "../lib/busyness";

const del = process.argv.includes("--delete");
const withCalendar = process.argv.includes("--calendar");
// --share：見せる用（npm run start:share）の置き場（SHARE_DATA_DIR、既定 data/runtime-share/）だけを片付ける。発表用のデータには触らない
if (process.argv.includes("--share")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // .env がなければ既定の置き場
  }
  process.env.DATA_RUNTIME_DIR = path.resolve((process.env.SHARE_DATA_DIR ?? "").trim() || path.join("data", "runtime-share"));
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.join(process.cwd(), "data", "runtime-backup", stamp);
const rel = (p: string) => path.relative(process.cwd(), p);

/** 片付けるもの：実行時のデータの置き場は、保存したカレンダーを除いた中身を1つずつ（移し先は backup/<置き場の名前>/…） */
function items(): Array<{ from: string; to: string }> {
  const root = path.resolve(runtimeRoot());
  const out: Array<{ from: string; to: string }> = [];
  for (const target of resetTargets()) {
    if (!fs.existsSync(target)) continue;
    if (path.resolve(target) === root && fs.statSync(target).isDirectory()) {
      for (const name of fs.readdirSync(target)) {
        if (name === CALENDAR_CACHE_NAME && !withCalendar) continue;
        out.push({ from: path.join(target, name), to: path.join(backup, path.basename(target), name) });
      }
      continue;
    }
    if (fs.statSync(target).isDirectory() && fs.readdirSync(target).length === 0) continue;
    out.push({ from: target, to: path.join(backup, path.basename(target)) });
  }
  return out;
}

let moved = 0;
for (const { from, to } of items()) {
  if (del) {
    fs.rmSync(from, { recursive: true, force: true });
    console.log(`消しました：${rel(from)}`);
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    console.log(`移しました：${rel(from)} → ${rel(to)}`);
  }
  moved++;
}
const kept = !withCalendar && fs.existsSync(path.join(runtimeRoot(), CALENDAR_CACHE_NAME));
// 記録（使われた結果・実行の記録・受信箱・金額）を残すなら、戻す前に写す
console.log("記録を残すときは、戻す前に npm run save:session（見せる用は npm run save:session -- --share）で data/sessions/ に写してください");
console.log(moved ? `\n初期状態に戻しました（${moved}件）。画面を読み込み直してください` : "片付けるものはありませんでした（初期状態です）");
if (kept) console.log(`保存したカレンダー（${rel(path.join(runtimeRoot(), CALENDAR_CACHE_NAME))}）は残しました（片付けるときは --calendar）`);
