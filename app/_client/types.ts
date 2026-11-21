// Shapes the screens use. Server types are imported read-only from lib/.
import type { CandidateCard, ProposalResult } from "@/lib/agent";
import type { Card, DeclineReason, OutreachResult } from "@/lib/cards";

export type { AgentEvent, CandidateCard, ProposalResult } from "@/lib/agent";
export type { Card, CardFormat, DeclineReason, OutreachResult } from "@/lib/cards";
export type { SpeakingRequest } from "@/lib/data";
export type { OutreachDraft } from "@/lib/heavy";
export type { NotebookEvent } from "@/lib/notebook";
export type { ModelChoice } from "@/lib/usage";
export type { InboxDetail, InboxListItem, InboxStatus } from "@/lib/inbox";
export type { Reaction } from "@/lib/cards";
export type { EventAnalysis, EventListItem, NegativeItem, PositiveTheme, SurveyEvent, TalkAnalysis } from "@/lib/surveys";
export type { ColumnInfo, ColumnRole } from "@/lib/surveyCsv";
import type { SurveyImport } from "@/lib/surveyCsv";
/** POST /api/events/{id}/import の返り値（回答そのものは返さない） */
export type ImportResult = Omit<SurveyImport, "answers"> & { answers: number; saved: boolean };
import type { eventDetail } from "@/lib/surveys";
/** GET /api/events/{id} の形 */
export type EventDetail = NonNullable<ReturnType<typeof eventDetail>>;
export type { VenueCard, VenueEvent, VenueResult } from "@/lib/venues";
export type { Person, PersonDetail, PersonPatch, PersonRow, SpeakingIntent } from "@/lib/people";
export type { ArchiveDetail, ArchiveKind, ArchiveRow } from "@/lib/archive";
export type { IntakeField, IntakeReading } from "@/lib/intake";

/** カード → 出し先：声かけ文の下書きを頼むときの本文（イベントの情報はサーバーがデータから引き直す） */
export interface VenueDraftBody {
  run_id: string;
  card_id: string;
  event_id: string;
  theme: string;
  reason: string;
  cautions: string[];
}

/** One card as GET /api/cards returns it (card + joined employee, evidence, publication records). */
export type NotebookCard = Card & {
  employee: {
    id: string;
    name: string;
    business_unit: string;
    role: string;
    past_talk_count: number;
    last_talk_date: string | null;
    /** 今後2週間の予定の埋まり具合（言葉）。lib/busyness.ts で計算 */
    busy_text: string;
  } | null;
  evidence: Array<{ id: string; type: string; date: string; title: string; body: string; where: string | null; url?: string | null }>;
  announcements: Array<{ id: string; date: string; title: string }>;
  published: Array<{ id: string; date: string; genre: string; title: string; url: string }>;
};

export type BlogIdea = { card_id: string; title: string; why_easy_to_blog: string; outline: string[] };

export type CardPatch = Partial<Pick<Card, "summary" | "themes" | "format" | "format_reason">>;

export interface OutcomeBody {
  request_id: string;
  custom_text?: string;
  card_id: string | null;
  result: OutreachResult;
  reason?: DeclineReason;
  candidate: { employee_id: string; theme: string; reason: string; evidence_activity_ids: string[] };
}

export interface DraftBody {
  run_id: string;
  request_id?: string;
  custom_text?: string;
  candidate: OutcomeBody["candidate"];
}

export type Proposal = ProposalResult;
export type Candidate = CandidateCard;
