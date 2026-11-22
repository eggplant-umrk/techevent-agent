import { requests, type SpeakingRequest } from "./data";
import { getInboxItem, inboxRequest } from "./inbox";

/** 貼った文（custom_text）を直接送られたときの断りの文。会話は受信箱に入れて関所（依頼ではない・不適切・読み取りの失敗）を通す */
export const CUSTOM_TEXT_CLOSED = "貼った文を直接送ることはできません。会話は「会話を貼って追加」から受信箱に入れてください（依頼かどうかを確かめてから候補を準備します）";

/**
 * 依頼を id で引く：サンプルの依頼（req…）か、受信箱の依頼（inb-…）。
 * 貼った文（custom_text）をその場で依頼にする道は閉じた（受信箱の関所を通らないため）。画面は会話を受信箱に入れる
 */
export function resolveRequest(body: { request_id?: string; custom_text?: string }): SpeakingRequest | null {
  if (body.custom_text !== undefined && body.custom_text !== null && body.custom_text !== "") return null;
  if (body.request_id?.startsWith("inb-")) {
    const it = getInboxItem(body.request_id);
    // 不適切なもの・人が進めていない「依頼ではない」もの・読み取りに失敗した／拒否されたものは、候補づくり・下書き・返事に使わない
    if (!it || it.read_status === "failed" || it.read_status === "refused" || it.kind === "inappropriate" || (it.kind === "not_request" && it.kind_override !== "request")) return null;
    return inboxRequest(it);
  }
  if (body.request_id && !body.request_id.startsWith("custom")) {
    return requests().find((r) => r.id === body.request_id) ?? null;
  }
  return null;
}
