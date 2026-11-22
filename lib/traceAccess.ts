// 実行の記録の画面（この依頼の記録）を開けるのは、この端末（127.0.0.1）からだけ。
//   - 発表用（既定）：入口（proxy.ts）が localhost からしか受け付けないので、開ける
//   - 見せる用（SHARE_MODE=lan）：送り元（x-forwarded-for。npm run start:share は接続そのものの値に置き換える）が
//     この端末のときだけ開ける。会場の参加者の端末からは開けない（金額の表示は一覧に出してよい）
import { isLoopback, shareMode } from "./share";

const LOOPBACK_IP = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

export function traceAllowed(req: Request): boolean {
  if (shareMode() !== "lan") return true;
  const from = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  const host = req.headers.get("host") ?? "";
  return LOOPBACK_IP.has(from) && isLoopback(host);
}
