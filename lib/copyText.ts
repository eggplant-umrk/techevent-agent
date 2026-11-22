// 文をクリップボードにコピーする（ブラウザの中だけで使う）。
// navigator.clipboard は安全なページ（https か localhost）でしか使えない。
// 見せる用を IP アドレス（http://192.168.x.x:3100）で開くと navigator.clipboard がないので、
// そのときは画面の外に置いたテキスト欄を選んで document.execCommand("copy") でコピーする。
// どちらもだめなら false（呼んだ側が、文を選んだ状態で「Ctrl+C でコピーしてください」と出す）

/** 画面の外のテキスト欄を選んで、古いやり方（execCommand）でコピーする。できたら true */
export function copyByExecCommand(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const active = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)) : [];
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  // 画面の外に置く（display:none だと選べない）。文字の大きさは、スマホで拡大されないように 16px
  area.style.cssText = "position:fixed;top:0;left:-9999px;width:1px;height:1px;padding:0;border:0;opacity:0;font-size:16px;";
  document.body.appendChild(area);
  let ok = false;
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  // 選んでいた範囲とフォーカスを戻す
  if (selection) {
    selection.removeAllRanges();
    for (const r of ranges) selection.addRange(r);
  }
  active?.focus?.({ preventScroll: true });
  return ok;
}

/** コピーできたら true。navigator.clipboard が使えない・断られたときは execCommand に切り替える */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 下の方法に切り替える
  }
  return copyByExecCommand(text);
}
