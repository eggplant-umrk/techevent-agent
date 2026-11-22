// 依頼の状態（コードで決める。AI は使わない）。画面（モック）からも使うので、ファイルやデータを読まない純粋な関数だけにする。
//
//   準備中 → 候補準備済み → 下書き中（声かけ文の下書きを作った）→ 声かけ中（声かけ文をコピーした）→ 承諾済み／辞退（結果を記録した）→ 開催後（アーカイブ）
//
// 決め方：カードの打診履歴（outreach_history）のうち、その依頼の記録を人ごとに見て、人ごとの最後の記録で決める。
// - だれかの最後が「承諾」か「公開」なら 承諾済み（誰が受けたかも返す）
// - そうでなく、だれかの最後が「承認」（声をかけて返事待ち）なら 声かけ中
//   → 辞退のあとに別の候補へ声をかけたら、また声かけ中に戻る
// - そうでなく、下書きを作っただけの人（下書きが保存されていて、打診の記録がまだない人）がいれば 下書き中
//   → 「この人で進める」を押して下書きを作っただけでは、まだ声をかけていない。声かけ文をコピーしたときに「承認」を記録して声かけ中にする
// - そうでなく、だれかが「辞退」なら 辞退
// - 記録がなければ、受信箱の状態（準備中・候補準備済み・エラー）のまま
// - 開催日が過ぎていれば 開催後（ほかのどの状態よりも先に見る）

export type RequestStage = "new" | "preparing" | "error" | "ready" | "drafting" | "outreach" | "accepted" | "declined" | "archived";

export const STAGE_LABEL: Record<RequestStage, string> = {
  new: "候補を出す前",
  preparing: "候補を準備中",
  error: "エラー",
  ready: "候補準備済み",
  drafting: "下書き中",
  outreach: "声かけ中",
  accepted: "承諾済み",
  declined: "辞退",
  archived: "開催後",
};

/** 印の色（components/ui.tsx の Tag の tone） */
export const STAGE_TONE: Record<RequestStage, "neutral" | "accent" | "warn" | "ok"> = {
  new: "neutral",
  preparing: "neutral",
  error: "warn",
  ready: "ok",
  drafting: "neutral",
  outreach: "accent",
  accepted: "ok",
  declined: "warn",
  archived: "neutral",
};

export interface OutreachRecord {
  employee_id: string;
  name: string;
  result: "approved" | "accepted" | "declined" | "published";
}

export interface RequestState {
  stage: RequestStage;
  /** 承諾した人（承諾済みのとき） */
  accepted_by: Array<{ employee_id: string; name: string }>;
  /** 声をかけて返事待ちの人 */
  outreach_to: Array<{ employee_id: string; name: string }>;
  /** 辞退した人 */
  declined_by: Array<{ employee_id: string; name: string }>;
  /** 下書きを作っただけの人（下書きが保存されていて、打診の記録がまだない人） */
  drafting_for: Array<{ employee_id: string; name: string }>;
}

/**
 * records：その依頼の打診記録を、記録した順に並べたもの（同じ人の記録はあとのものが新しい）。
 * base：受信箱の状態（サンプルの依頼で候補をまだ出していなければ "new"）。
 * drafted：下書きが保存されている人（その依頼の分）。打診の記録がまだない人だけを「下書き中」に数える
 */
export function requestState(
  base: "new" | "processing" | "ready" | "error",
  records: OutreachRecord[],
  eventDate: string | null,
  today: string,
  drafted: Array<{ employee_id: string; name: string }> = [],
): RequestState {
  const last = new Map<string, OutreachRecord>();
  for (const r of records) last.set(r.employee_id, r);
  const people = (pred: (r: OutreachRecord) => boolean) =>
    [...last.values()].filter(pred).map((r) => ({ employee_id: r.employee_id, name: r.name }));
  const accepted_by = people((r) => r.result === "accepted" || r.result === "published");
  const outreach_to = people((r) => r.result === "approved");
  const declined_by = people((r) => r.result === "declined");
  const drafting_for = base === "ready" ? drafted.filter((d) => !last.has(d.employee_id)) : [];
  let stage: RequestStage;
  if (eventDate && eventDate < today) stage = "archived";
  else if (accepted_by.length) stage = "accepted";
  else if (outreach_to.length) stage = "outreach";
  else if (drafting_for.length) stage = "drafting";
  else if (declined_by.length) stage = "declined";
  else stage = base === "processing" ? "preparing" : base;
  return { stage, accepted_by, outreach_to, declined_by, drafting_for };
}

/** カードの打診履歴から、その依頼の記録だけを取り出す（記録した順） */
export function recordsFor(
  requestId: string,
  cards: Array<{ employee_id: string; outreach_history: Array<{ request_id: string; result: OutreachRecord["result"]; date?: string }> }>,
  nameOf: (employeeId: string) => string,
): OutreachRecord[] {
  // 日付の順に並べる（同じ日なら記録の順のまま。sort は安定）
  return cards
    .flatMap((c) =>
      c.outreach_history
        .filter((h) => h.request_id === requestId)
        .map((h) => ({ employee_id: c.employee_id, name: nameOf(c.employee_id), result: h.result, date: h.date ?? "" })),
    )
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map(({ date: _d, ...r }) => r);
}

/** カード側：そのカードの人が承諾した依頼（依頼ごとの最後の記録が承諾・公開のもの） */
export function acceptedRequestIds(card: { outreach_history: Array<{ request_id: string; result: OutreachRecord["result"] }> }): string[] {
  const last = new Map<string, OutreachRecord["result"]>();
  for (const h of card.outreach_history) last.set(h.request_id, h.result);
  return [...last].filter(([, r]) => r === "accepted" || r === "published").map(([id]) => id);
}
