// 候補ができるまでの進み具合（画面に1行で出す）。作業ログの流れ（AgentEvent）から、今の段階をコードで決める。
// 考えた内容（thinking）や、ツール・カードの名前（内部の名前）は出さない。段階の言葉だけ。
// 画面（モック）からも使うので、ファイルやデータを読まない純粋な関数だけにする。

export type ProgressStage = "reading" | "searching" | "narrowing" | "drafting";

export const PROGRESS_ORDER: ProgressStage[] = ["reading", "searching", "narrowing", "drafting"];

export const PROGRESS_LABEL: Record<ProgressStage, string> = {
  reading: "依頼を読んでいます",
  searching: "ネタ帳を探しています",
  narrowing: "候補を絞っています",
  drafting: "下書きを準備しています",
};

export interface Progress {
  stage: ProgressStage;
  /** 1〜4（何段階目か） */
  step: number;
  of: number;
}

/** 探す道具（ネタ帳・投稿・社員の絞り込み） */
const SEARCH = new Set(["search_cards", "search_activities", "list_employees"]);
/** 一人ずつ確かめる道具（カード・社員・登壇履歴・予定・発信済み） */
const NARROW = new Set(["get_card", "get_employee", "get_speaking_history", "check_schedule", "get_published"]);

/**
 * 作業ログの1件から、次の段階を決める。段階は戻らない（探す→絞る→探す と行き来しても、表示は先へ進むだけ）。
 * 分からないものは今の段階のまま。
 */
export function nextStage(prev: ProgressStage, e: { type: string; name?: string }): ProgressStage {
  let s: ProgressStage = prev;
  if (e.type === "tool_call" && e.name) {
    if (SEARCH.has(e.name)) s = "searching";
    else if (NARROW.has(e.name)) s = "narrowing";
    else if (e.name === "submit_candidates") s = "drafting";
  }
  if (e.type === "final" || e.type === "alternative_pitch") s = "drafting";
  return PROGRESS_ORDER.indexOf(s) > PROGRESS_ORDER.indexOf(prev) ? s : prev;
}

export const progressOf = (stage: ProgressStage): Progress => ({ stage, step: PROGRESS_ORDER.indexOf(stage) + 1, of: PROGRESS_ORDER.length });

/** 作業ログ全体から、今の段階 */
export function stageOfEvents(events: Array<{ type: string; name?: string }>): ProgressStage {
  return events.reduce<ProgressStage>((s, e) => nextStage(s, e), "reading");
}

/** 画面の1行（「ネタ帳を探しています（2/4）」） */
export const progressText = (p: Progress) => `${PROGRESS_LABEL[p.stage]}（${p.step}/${p.of}）`;
