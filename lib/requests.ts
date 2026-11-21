import { requests, type SpeakingRequest } from "./data";
import { getInboxItem, inboxRequest } from "./inbox";

/** Resolve a preset request by id, an inbox request by id (inb-…), or wrap pasted text as a request. */
export function resolveRequest(body: { request_id?: string; custom_text?: string }): SpeakingRequest | null {
  if (body.request_id?.startsWith("inb-")) {
    const it = getInboxItem(body.request_id);
    // 不適切なもの・人が進めていない「依頼ではない」ものは、候補づくり・下書き・返事に使わない
    if (!it || it.kind === "inappropriate" || (it.kind === "not_request" && it.kind_override !== "request")) return null;
    return inboxRequest(it);
  }
  if (body.request_id && !body.request_id.startsWith("custom")) {
    return requests().find((r) => r.id === body.request_id) ?? null;
  }
  const text = body.custom_text?.trim();
  if (!text) return null;
  return { id: body.request_id ?? `custom-${Date.now().toString(36)}`, message: text.slice(0, 4000) };
}
