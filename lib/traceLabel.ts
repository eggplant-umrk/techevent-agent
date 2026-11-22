// 「この依頼の記録」に出す名前。内部の名前（inbox_extract・loop・search_cards など）を、使う人の言葉にする。
// 画面（components/TraceTimeline.tsx）とテストから使うので、ファイルやデータは読まない純粋な関数だけにする

/** AI の呼び出し（使い道の名前。lib/data.ts の UsageEntry["purpose"]） */
const LLM_LABEL: Record<string, string> = {
  inbox_extract: "会話を読む",
  loop: "候補を探す",
  draft: "下書きを作る",
  alternative_pitch: "代わりの人を推す文を作る",
  notebook: "ネタ帳を更新する",
  blog_ideas: "ブログのネタを考える",
  judge: "判定する",
  survey: "アンケートを読む",
  release_cards: "リリースからネタを作る",
};

/** ツール・コードの処理（lib/tools.ts のツールの名前） */
const TOOL_LABEL: Record<string, string> = {
  search_cards: "カードを探す",
  get_card: "カードを読む",
  upsert_card: "カードを書く",
  search_activities: "活動を探す",
  list_employees: "人の一覧を読む",
  get_employee: "人の情報を読む",
  get_speaking_history: "登壇の記録を読む",
  check_schedule: "予定を確かめる",
  get_published: "発信済みの記事を読む",
  submit_candidates: "候補を出す",
  submit_venues: "出し先を出す",
};

/** 記録の1行に出す名前。知らない名前は、AI の呼び出しなら「AI の呼び出し」、ほかはそのまま（日本語の名前はそのまま出る） */
export function traceStepLabel(kind: "llm" | "tool" | "code", name: string): string {
  if (kind === "llm") return LLM_LABEL[name] ?? "AI の呼び出し";
  return TOOL_LABEL[name] ?? name;
}
