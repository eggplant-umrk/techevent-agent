// 発表用の画面 /share-links で使う、見せる用（3100番）のアドレス。この PC の会場の Wi-Fi の IP（IPv4）と見せる用のポートから作る
import os from "node:os";

/**
 * 会場の Wi-Fi らしさの順位（小さいほど先）：Wi-Fi の名前 → 家庭・会場の LAN の範囲（192.168・10・172.16〜31）→ そのほか →
 * 仮想の口（vEthernet・VirtualBox・WSL など）と Tailscale（100.64.0.0/10）
 */
export function lanRank(a: { name: string; ip: string }): number {
  const [x, y] = a.ip.split(".").map(Number);
  const virtual = /vethernet|virtual|vmware|vbox|wsl|docker|hyper-v|loopback|tailscale|zerotier|utun|tun|tap/i.test(a.name) || (x === 100 && y >= 64 && y <= 127);
  if (virtual) return 3;
  if (/wi-?fi|wlan|wireless|無線/i.test(a.name)) return 0;
  const lan = x === 192 && y === 168 ? true : x === 10 ? true : x === 172 && y >= 16 && y <= 31;
  return lan ? 1 : 2;
}

/** この PC の IPv4（内部のものを除く）。名前つき・会場の Wi-Fi らしい順 */
export function lanAddresses(): Array<{ name: string; ip: string }> {
  const out: Array<{ name: string; ip: string }> = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) out.push({ name, ip: a.address });
  }
  return out.sort((a, b) => lanRank(a) - lanRank(b));
}

/** 見せる用のポート（SHARE_PORT、既定 3100） */
export const sharePort = () => (process.env.SHARE_PORT ?? "").trim() || "3100";

/** 選んだ IP（この PC のものだけ。なければ最初のもの） */
export function chooseIp(want: string | null | undefined): { name: string; ip: string } | null {
  const addrs = lanAddresses();
  return addrs.find((a) => a.ip === want) ?? addrs[0] ?? null;
}

export const shareBaseUrl = (ip: string) => `http://${ip}:${sharePort()}`;
/** 合言葉入りの入口のリンク（一般用・メンター用とも） */
export const joinUrl = (ip: string, code: string) => `${shareBaseUrl(ip)}/join?code=${encodeURIComponent(code)}`;
