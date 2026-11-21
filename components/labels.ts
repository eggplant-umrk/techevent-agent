import type { DeclineReason, OutreachResult } from "@/app/_client/types";

export const PATTERN_LABEL: Record<string, string> = { open_slot: "枠だけの依頼", theme_specified: "テーマ指定", named_speaker: "指名の依頼" };
export const STATUS_LABEL: Record<string, string> = { unpublished: "未発信", blogged: "ブログ済み", talked: "登壇済み" };
export const FORMAT_LABEL: Record<string, string> = { talk: "登壇", lt: "LT", blog: "ブログ" };
export const RESULT_LABEL: Record<OutreachResult, string> = { approved: "承認", accepted: "承諾", declined: "辞退", published: "公開" };
export const REASON_LABEL: Record<DeclineReason, string> = {
  theme_mismatch: "テーマが合わない",
  busy: "忙しい",
  schedule_conflict: "予定が重なる",
  other: "その他",
};
export const ACTIVITY_LABEL: Record<string, string> = { slack_post: "Slack", github_pr: "PR", design_doc: "設計", weekly_report: "週報", release_note: "リリース" };
export const FIELD_LABEL: Record<string, string> = { summary: "要約", themes: "テーマ案", format: "おすすめの形", format_reason: "形の理由", evidence: "根拠" };
export const TOOL_LABEL: Record<string, string> = {
  search_cards: "ネタ帳を検索した",
  get_card: "カードを開いた",
  search_activities: "投稿を検索した",
  list_employees: "社員を絞り込んだ",
  get_employee: "社員の詳細を見た",
  get_speaking_history: "登壇履歴を見た",
  check_schedule: "予定を確認した",
  get_published: "発信済みを確認した",
  submit_candidates: "候補を出した",
};

export const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;
/** "2026-10-02" → "10/02" */
export const md = (d: string | null | undefined) => (d ? d.slice(5, 10).replace("-", "/") : "");
