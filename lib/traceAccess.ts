// 実行の記録の画面（この依頼の記録）を開けるか。
//   記録の中身は名前・時間・金額・成否だけ（会話の原文・指示文・ツールの入出力は入っていない。lib/trace.ts）なので、
//   見せる用（SHARE_MODE=lan）でも開ける（11/22 から）。入口（proxy.ts）の合言葉は今までどおり要る
export function traceAllowed(_req: Request): boolean {
  return true;
}
