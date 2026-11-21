// デモの前に、元のデータだけの初期状態に戻す（npm run reset:demo）。API は使わない。
//   - 実行時のデータ（data/runtime/：打診・承諾の記録、カードの編集、割り当て、ネタ帳の更新の結果など）と、
//     画面の操作の記録（受信箱 data/inbox.json、サンプルの依頼の結果、下書き、登壇の記録）を片付ける
//   - 消さずに data/runtime-backup/<日時>/ に移す（必要なら戻せる）。--delete を付けると消す
//   - 元のデータ（git に入っている data/ のファイル）・金額の記録（data/usage.json）・アンケートの分析結果は触らない
//   - 開発サーバーが動いていると、画面に前の状態が残ることがある。片付けたあとは画面を読み込み直す
import fs from "node:fs";
import path from "node:path";
import { resetTargets } from "../lib/runtime";

const del = process.argv.includes("--delete");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = path.join(process.cwd(), "data", "runtime-backup", stamp);
const rel = (p: string) => path.relative(process.cwd(), p);

let moved = 0;
for (const target of resetTargets()) {
  if (!fs.existsSync(target)) continue;
  if (fs.statSync(target).isDirectory() && fs.readdirSync(target).length === 0) continue;
  if (del) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`消しました：${rel(target)}`);
  } else {
    const to = path.join(backup, path.basename(target));
    fs.mkdirSync(backup, { recursive: true });
    fs.renameSync(target, to);
    console.log(`移しました：${rel(target)} → ${rel(to)}`);
  }
  moved++;
}
console.log(moved ? `\n初期状態に戻しました（${moved}件）。画面を読み込み直してください` : "片付けるものはありませんでした（初期状態です）");
