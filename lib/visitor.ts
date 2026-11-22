// 見せる用（SHARE_MODE=lan）で「人」を見分ける決まり（ここに1つだけ置く）。
//   - 1人＝合言葉で入ったブラウザ。入ったときに人ごとの印（cookie nb_person、ランダムな値、httpOnly）を付ける
//     （合言葉の印 nb_access は全員同じ値なので、人を分けるのに使えない）
//   - 保存や数えるのに使うのは、印の値のハッシュ（visitorKey）だけ。印の値そのものは保存しない・記録に出さない
//   - 使う側：人ごとの置き場所（lib/runtime.ts の data/runtime-share/visitors/{ハッシュ}/）と、①の1人あたりの金額の上限
import { createHash, randomBytes } from "node:crypto";

export const VISITOR_COOKIE = "nb_person";
/** 人の印がない要求（合言葉をヘッダー X-Access-Code で送るスクリプトなど）をまとめる名前 */
export const NO_VISITOR = "no-person";

/** 新しい人の印（ランダム、144ビット） */
export const newVisitorId = (): string => randomBytes(18).toString("base64url");

/** 印の値 → 保存に使う名前（ハッシュ、英数字32文字）。印がなければ NO_VISITOR */
export function visitorKey(cookieValue: string | null | undefined): string {
  const v = (cookieValue ?? "").trim();
  if (!v) return NO_VISITOR;
  return createHash("sha256").update(`netacho-person:${v}`).digest("hex").slice(0, 32);
}

/** Cookie ヘッダーから人の印の値（なければ null） */
export function visitorCookieOf(cookieHeader: string | null | undefined): string | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === VISITOR_COOKIE) {
      try {
        return decodeURIComponent(v.join("=")) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** 要求がどの人からか（保存に使う名前）。人の印がなければ NO_VISITOR */
export function visitorKeyOf(req: Pick<Request, "headers">): string {
  return visitorKey(visitorCookieOf(req.headers.get("cookie")));
}

/** 保存に使う名前として正しい形か（フォルダ名に使う前に確かめる） */
export const isVisitorKey = (key: string): boolean => key === NO_VISITOR || /^[0-9a-f]{32}$/.test(key);

/** 人の印の cookie（httpOnly・12時間。合言葉の印と同じ長さ） */
export const visitorCookieHeader = (id: string): string => `${VISITOR_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 12}`;
