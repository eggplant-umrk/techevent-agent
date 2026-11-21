// サーバーの起動時に1回だけ動く（Next.js の instrumentation）。中身は instrumentation-node.ts（Node.js で動くときだけ読む）。
// この形（NEXT_RUNTIME の分かれ道の中で import）にしないと、Edge 向けの組み立てに node: のモジュールが入って失敗する。
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
