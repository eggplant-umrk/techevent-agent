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
  search_external_events: "社外のイベントを探す",
  submit_columns: "アンケートの列の意味を出す",
  submit_survey_analysis: "アンケートのまとめを出す",
  submit_release_cards: "リリースのネタを出す",
  // コードの処理
  date_suggestions: "空いていそうな日を出す",
};

/** 英数字と記号だけの名前（内部の名前）か */
const INTERNAL_NAME = /^[A-Za-z0-9_.:-]+$/;

/**
 * 記録の1行に出す名前。
 * - 知らない名前：AI の呼び出しなら「AI の呼び出し」。ツール・処理は、日本語の名前ならそのまま、
 *   英数字だけの名前（置き換えが抜けた内部の名前）なら「そのほかのツール」「そのほかの処理」にする（内部の名前を画面に出さない。元の名前は title に残る）
 */
export function traceStepLabel(kind: "llm" | "tool" | "code", name: string): string {
  if (kind === "llm") return LLM_LABEL[name] ?? "AI の呼び出し";
  if (TOOL_LABEL[name]) return TOOL_LABEL[name];
  if (INTERNAL_NAME.test(name)) return kind === "tool" ? "そのほかのツール" : "そのほかの処理";
  return name;
}

/** 置き換えの言葉がある名前か（テストが、ツール・処理の名前の抜けを見つけるのに使う） */
export const hasTraceLabel = (kind: "llm" | "tool" | "code", name: string): boolean => (kind === "llm" ? name in LLM_LABEL : name in TOOL_LABEL);

/** 失敗の種類（lib/trace.ts の errorKind と、ツールの "failed"）を言葉にする。言葉が要らないものは空（「失敗」だけ出す） */
export function traceErrorLabel(error: string | null | undefined): string {
  const e = (error ?? "").trim();
  if (!e || e === "failed" || e === "error") return "";
  if (e === "timeout") return "時間切れ";
  if (e === "aborted") return "途中で止めた";
  if (e === "connection") return "つながらなかった";
  if (e === "429") return "混んでいる・上限";
  if (e === "529") return "AI が混んでいる";
  if (/^\d{3}$/.test(e)) return `エラー ${e}`;
  return INTERNAL_NAME.test(e) ? "" : e;
}
