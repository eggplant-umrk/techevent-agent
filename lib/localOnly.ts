// 受信箱の窓口は、同じマシン（localhost）からのリクエストだけ受け付ける。
// 開発サーバーは 127.0.0.1 だけで待ち受ける（package.json の dev）。そのうえで、ここでは
// Host ヘッダーと、転送されてきた場合の送り元（X-Forwarded-For）が localhost かを確かめる。
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"]);

function hostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1); // [::1]:3000
  return h.replace(/:\d+$/, "");
}

export function isLocalRequest(req: Request): boolean {
  // 別の端末に見せる設定（SHARE_MODE=lan）では、入口（proxy.ts）が合言葉と Origin を確かめ済み
  if ((process.env.SHARE_MODE ?? "").trim().toLowerCase() === "lan") return true;
  const host = req.headers.get("host");
  if (!host || !LOOPBACK.has(hostname(host))) return false;
  const xff = req.headers.get("x-forwarded-for");
  if (xff && !xff.split(",").every((ip) => LOOPBACK.has(ip.trim().toLowerCase()))) return false;
  return true;
}

export function forbidden() {
  return Response.json({ error: "localhost からのリクエストだけ受け付けます" }, { status: 403 });
}
