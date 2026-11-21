// 使う人（技術広報）向けの文に、内部の項目名・値・idが混ざっていないかをコードで判定する。
// 例：「reviewed=false」「confidence」「card_id」「act088」「req003」「search_cards」
// 人の名前・投稿のタイトル・日付で書いてもらうためのチェック。

const FIELD_NAMES = [
  "reviewed",
  "confidence",
  "conditional",
  "caveat",
  "cautions",
  "card_id",
  "employee_id",
  "evidence_activity_ids",
  "evidence_request_ids?",
  "announcement_activity_ids",
  "published_ids",
  "pending_themes",
  "outreach_history",
  "publication_status",
  "unpublished",
  "blogged",
  "talked",
  "is_alternative_to_nominee",
  "is_nominee",
  "nominee",
  "nominee_assessment",
  "workload",
  "past_talk_count",
  "last_talk_date",
  "latest_activity_date",
  "learnings_applied",
  "no_fit",
  "next_checks",
  "request_pattern",
  "open_slot",
  "theme_specified",
  "named_speaker",
  "format_reason",
];
const TOOL_NAMES = [
  "search_cards",
  "get_card",
  "upsert_card",
  "search_activities",
  "list_employees",
  "get_employee",
  "get_speaking_history",
  "check_schedule",
  "get_published",
  "submit_candidates",
  "read_learnings",
];

const RULES: Array<{ re: RegExp; label: string }> = [
  { re: new RegExp(String.raw`\b(${[...FIELD_NAMES, ...TOOL_NAMES].join("|")})\b`, "gi"), label: "内部の項目名" },
  { re: /\bstrong\b/gi, label: "内部の値" },
  { re: /\b(true|false|null)\b/gi, label: "内部の値" },
  { re: /\bcard-e\d{3}-[\w]+\b/gi, label: "カードのid" },
  { re: /\b(act|req|pub)\d{3}\b/gi, label: "内部のid" },
  { re: /\be\d{3}\b/gi, label: "社員のid" },
  { re: /[a-z_]+\s*=\s*[\w"]+/gi, label: "項目=値の書き方" },
];

/** 見つかった内部の言葉（重複なし）。空なら問題なし。 */
export function internalTerms(text: string | null | undefined): string[] {
  if (!text) return [];
  const hits = new Set<string>();
  for (const { re, label } of RULES) {
    for (const m of text.matchAll(re)) hits.add(`${label}「${m[0]}」`);
  }
  return [...hits];
}

/** 複数の文をまとめて判定。where は「どこに書いたか」の説明（差し戻し文に使う）。 */
export function internalTermProblems(items: Array<{ where: string; text: string | null | undefined }>): string[] {
  const out: string[] = [];
  for (const { where, text } of items) {
    const hits = internalTerms(text);
    if (hits.length) out.push(`${where}に${hits.join("、")}が入っています`);
  }
  return out;
}

/** Agentへの指示文に入れる共通の一文。 */
export const PLAIN_TEXT_RULE =
  "使う人（技術広報）向けの文（要約・テーマ案・理由・注意点・引っかかる点・見つからない理由・次に確認すべきこと・声かけ文など）には、内部の項目名・値・id（reviewed、confidence、card_id、strong、conditional、true/false、act001、req001、e001、card-e001-01、ツール名など）を書かない。人の名前・投稿のタイトル・日付・「確認済み／未確認」「条件付き」などの普通の言葉で書く";
