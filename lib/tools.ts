// Agent tools over data/*.json. Results are kept short (top 10, 200-char bodies).
import type Anthropic from "@anthropic-ai/sdk";
import { activities, employeeById, employees, events, published, schedules } from "./data";
import { BODY_CHARS, SEARCH_LIMIT } from "./config";
import { filterCards, getCardById, loadCards, outreachSummary, type CardFilter } from "./cards";

const clip = (s: string, n = BODY_CHARS) => (s.length > n ? s.slice(0, n) + "…" : s);

// ---------------------------------------------------------------------------
// Tool definitions (order is fixed: part of the cached prefix)
// ---------------------------------------------------------------------------
export const SUBMIT_TOOL = "submit_candidates";

const BASE_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: "search_activities",
    description:
      "社内のSlack投稿・GitHubのPR・週報・設計ドキュメントから取り組みを探す。queryはスペース区切りのキーワード（日本語可、どれかに一致すれば候補、一致数でスコア）。上位10件を返す。本文は先頭200文字。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "キーワード（スペース区切り）" },
        since: { type: "string", description: "この日付以降（YYYY-MM-DD）。省略可" },
        type: {
          type: "string",
          enum: ["slack_post", "github_pr", "design_doc", "weekly_report"],
          description: "種類で絞る。省略可",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_employees",
    description: "条件で社員を絞り込む。得意分野タグ・事業部・忙しさの上限・登壇回数の上限で絞れる。",
    input_schema: {
      type: "object",
      properties: {
        business_unit: { type: "string" },
        tag: { type: "string", description: "得意分野タグの部分一致" },
        max_workload: { type: "integer", description: "忙しさ(1-5)の上限" },
        max_talk_count: { type: "integer", description: "過去の登壇回数の上限" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_employee",
    description: "社員1人の詳細（得意分野・忙しさ・登壇回数・直近の取り組み件数・発信数）を見る。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_speaking_history",
    description: "社員の登壇履歴（自社イベントでの登壇、最後に登壇した日、通算回数）を見る。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "check_schedule",
    description: "指定日の前後3日に、出張・他の登壇・リリース対応・休暇などの予定が重なっていないか見る。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["id", "date"],
      additionalProperties: false,
    },
  },
  {
    name: "get_published",
    description: "社員の発信済みの記録（ブログ・登壇資料・インタビューなど）を見る。そのテーマをすでに社外に出しているかの確認に使う。",
    input_schema: {
      type: "object",
      properties: { author_id: { type: "string" } },
      required: ["author_id"],
      additionalProperties: false,
    },
  },
  {
    name: SUBMIT_TOOL,
    description:
      "最終回答。候補を3人まで、おすすめ順に出す。これを呼んだら作業は終わり。自信のある候補（confidence=strong）を先に並べ、足りない分は条件付きの候補（confidence=conditional）として、何が引っかかるかを caveat に書いて3人まで埋める。本当に誰もいないときだけ候補を空にして no_fit を書く。根拠の取り組みIDは、この調査でカードや検索結果から実際に見たものだけを書く。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        request_pattern: { type: "string", enum: ["open_slot", "theme_specified", "named_speaker"] },
        summary: { type: "string", description: "依頼の読み取りと、今回の選び方の要約（2〜3文）" },
        nominee_assessment: {
          type: ["string", "null"],
          description: "指名の依頼のとき、指名された人の確認結果（テーマの合い具合・忙しさ・予定）。指名でなければnull",
        },
        learnings_applied: {
          type: "array",
          items: { type: "string" },
          description: "カードの打診履歴（過去の辞退・承諾）を今回どう反映したか。なければ空配列",
        },
        no_fit: {
          type: ["object", "null"],
          description:
            "候補が3人に満たないときだけ書く（条件付きの候補を含めても3人に届かない、または誰もいないとき）。3人そろえばnull",
          properties: {
            reasons: { type: "array", items: { type: "string" }, description: "合う候補が見つからない理由" },
            next_checks: { type: "array", items: { type: "string" }, description: "技術広報が次に確認すべきこと" },
          },
          required: ["reasons", "next_checks"],
          additionalProperties: false,
        },
        candidates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              employee_id: { type: "string" },
              card_id: { type: ["string", "null"], description: "根拠にしたネタ帳のカード。カードがない人ならnull" },
              theme: { type: "string", description: "テーマ案（タイトル風に）。カードのテーマ案を依頼に合わせて調整してよい" },
              reason: { type: "string", description: "選んだ理由を1行で（本人の取り組みと時流の両方から）" },
              evidence_activity_ids: {
                type: "array",
                items: { type: "string" },
                description: "根拠の activity id。発信済みで告知しかないカードなら空配列でよい",
              },
              cautions: {
                type: "array",
                items: { type: "string" },
                description: "注意点（最近登壇した／忙しい／予定が重なる など）",
              },
              is_alternative_to_nominee: {
                type: "boolean",
                description: "指名された人の代わり（または共同登壇）として推す人ならtrue",
              },
              confidence: {
                type: "string",
                enum: ["strong", "conditional"],
                description: "strong：テーマに合い、断られる3つの理由にも大きな引っかかりがない。conditional：候補にはなるが条件つき",
              },
              caveat: {
                type: ["string", "null"],
                description:
                  "conditional のとき必須。何が引っかかるかを1文で（例：忙しさ5で準備時間が取れるか要確認／テーマが少しずれる（障害対応ではなくオンコール改善）／根拠が1件だけ）。strong ならnull",
              },
            },
            required: [
              "employee_id",
              "card_id",
              "theme",
              "reason",
              "evidence_activity_ids",
              "cautions",
              "is_alternative_to_nominee",
              "confidence",
              "caveat",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["request_pattern", "summary", "nominee_assessment", "learnings_applied", "no_fit", "candidates"],
      additionalProperties: false,
    },
  },
];

/** strong: a confident pick. conditional: a usable pick with a stated catch (caveat). */
export type Confidence = "strong" | "conditional";

export interface SubmitInput {
  request_pattern: "open_slot" | "theme_specified" | "named_speaker";
  summary: string;
  nominee_assessment: string | null;
  learnings_applied: string[];
  no_fit: { reasons: string[]; next_checks: string[] } | null;
  candidates: Array<{
    employee_id: string;
    card_id: string | null;
    theme: string;
    reason: string;
    evidence_activity_ids: string[];
    cautions: string[];
    is_alternative_to_nominee: boolean;
    confidence: Confidence;
    caveat: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------
type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => (typeof v === "number" ? v : undefined);

export function searchActivities(input: Input) {
  const query = str(input.query) ?? "";
  const since = str(input.since);
  const type = str(input.type);
  const terms = query
    .split(/[\s　、,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const emps = new Map(employees().map((e) => [e.id, e]));
  const scored = activities()
    .filter((a) => (!since || a.date >= since) && (!type || a.type === type))
    .map((a) => {
      const hay = `${a.title} ${a.body} ${a.channel ?? ""} ${a.repo ?? ""}`.toLowerCase();
      const tags = (emps.get(a.author_id)?.expertise_tags ?? []).join(" ").toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (a.title.toLowerCase().includes(t)) score += 3;
        else if (hay.includes(t)) score += 2;
        else if (tags.includes(t)) score += 1;
      }
      return { a, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score || (y.a.date > x.a.date ? 1 : -1));
  return {
    total_hits: scored.length,
    results: scored.slice(0, SEARCH_LIMIT).map(({ a, score }) => ({
      id: a.id,
      type: a.type,
      date: a.date,
      author: `${a.author_id} ${emps.get(a.author_id)?.name ?? ""}`,
      title: a.title,
      body: clip(a.body),
      where: a.channel ?? a.repo,
      score,
    })),
  };
}

export function listEmployees(input: Input) {
  const unit = str(input.business_unit);
  const tag = str(input.tag)?.toLowerCase();
  const maxW = num(input.max_workload);
  const maxT = num(input.max_talk_count);
  return employees()
    .filter(
      (e) =>
        (!unit || e.business_unit === unit) &&
        (!tag || e.expertise_tags.some((t) => t.toLowerCase().includes(tag))) &&
        (maxW === undefined || e.workload <= maxW) &&
        (maxT === undefined || e.past_talk_count <= maxT),
    )
    .map((e) => ({
      id: e.id,
      name: e.name,
      unit: e.business_unit,
      role: e.role,
      tags: e.expertise_tags,
      talks: e.past_talk_count,
      last_talk: e.last_talk_date,
      workload: e.workload,
    }));
}

export function getEmployee(input: Input) {
  const id = str(input.id) ?? "";
  const e = employeeById(id);
  if (!e) return { error: `社員 ${id} は見つかりません` };
  const acts = activities().filter((a) => a.author_id === id);
  return {
    ...e,
    recent_activity_count: acts.length,
    recent_activity_titles: acts.slice(-5).map((a) => `${a.id} ${a.date} ${a.title}`),
    published_count: published().filter((p) => p.author_id === id).length,
  };
}

export function getSpeakingHistory(input: Input) {
  const id = str(input.id) ?? "";
  const e = employeeById(id);
  if (!e) return { error: `社員 ${id} は見つかりません` };
  const talks = events()
    .filter((ev) => ev.speaker_ids.includes(id))
    .map((ev) => ({ date: ev.date, title: ev.title, attendees: ev.attendees }));
  return {
    id,
    name: e.name,
    past_talk_count: e.past_talk_count,
    last_talk_date: e.last_talk_date,
    own_events: talks,
    note: talks.length < e.past_talk_count ? "通算回数には社外カンファレンスでの登壇も含む" : undefined,
  };
}

const addDays = (d: string, n: number) => {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export function checkSchedule(input: Input) {
  const id = str(input.id) ?? "";
  const date = str(input.date) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "date は YYYY-MM-DD で指定してください" };
  const lo = addDays(date, -3);
  const hi = addDays(date, 3);
  const items = schedules()
    .filter((s) => s.employee_id === id && s.from <= hi && s.to >= lo)
    .map((s) => ({ ...s, overlaps_event_day: s.from <= date && s.to >= date }));
  return {
    id,
    date,
    conflict: items.some((s) => s.overlaps_event_day),
    nearby: items,
    note: items.length === 0 ? "前後3日に既知の予定はありません" : undefined,
  };
}

export function getPublished(input: Input) {
  const id = str(input.author_id) ?? "";
  const items = published()
    .filter((p) => p.author_id === id)
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
  return {
    author_id: id,
    count: items.length,
    items: items.slice(0, SEARCH_LIMIT).map((p) => ({
      date: p.published_at.slice(0, 10),
      genre: p.genre,
      title: p.title,
      tags: p.tags,
    })),
  };
}

// ---------------------------------------------------------------------------
// Notebook (cards) tools
// ---------------------------------------------------------------------------
export const SEARCH_CARDS_DEF: Anthropic.Tool = {
  name: "search_cards",
  description:
    "ネタ帳（カード）を探す。依頼への提案では最初にこれを使う。queryはスペース区切りのキーワード。filterで未発信だけ・登壇経験なし・事業部・確認済みだけに絞れる。上位10枚を、テーマ案・要約・発信状況・確認済みか・打診履歴の要約つきで返す。",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "キーワード（スペース区切り）。空なら全件を新しい順" },
      filter: {
        type: "object",
        properties: {
          unpublished_only: { type: "boolean" },
          no_talk_experience: { type: "boolean" },
          business_unit: { type: "string" },
          reviewed_only: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const GET_CARD_DEF: Anthropic.Tool = {
  name: "get_card",
  description: "カード1枚の詳細（根拠の投稿のタイトルと日付、発信済みの記録、打診履歴のすべて）を見る。",
  input_schema: {
    type: "object",
    properties: { card_id: { type: "string" } },
    required: ["card_id"],
    additionalProperties: false,
  },
};

export const UPSERT_CARD_DEF: Anthropic.Tool = {
  name: "upsert_card",
  description:
    "カードを作る（card_id=null）か、既存のカードを更新する（card_id を指定）。ネタ帳の更新のときだけ使う。根拠は、この社員本人の実在する activity id だけ。存在しないidや他人のidは保存されずエラーが返る。",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      card_id: { type: ["string", "null"], description: "更新するカードのid。新しいカードはnull" },
      employee_id: { type: "string" },
      summary: { type: "string", description: "取り組みの要約（2〜3文。何をして、どんな成果か。数字があれば入れる）" },
      themes: {
        type: "array",
        items: { type: "string" },
        description: "話せるテーマ案を1〜3個。本人の取り組みから絞った具体的なタイトル",
      },
      evidence_activity_ids: {
        type: "array",
        items: { type: "string" },
        description: "取り組みの中身が分かる投稿の activity id。発信済みで告知しかない取り組みなら空配列でよい（そのときは published_ids が必須）",
      },
      format: { type: "string", enum: ["talk", "lt", "blog"], description: "おすすめの形" },
      format_reason: { type: "string", description: "その形をすすめる理由（1文）" },
      published_ids: {
        type: "array",
        items: { type: "string" },
        description: "この取り組みをすでに発信した published の id。なければ空配列",
      },
      announcement_activity_ids: {
        type: "array",
        items: { type: "string" },
        description: "「公開しました」「登壇しました」など発信の告知だけの投稿の activity id。根拠ではなく発信の記録として入れる。なければ空配列",
      },
    },
    required: [
      "card_id",
      "employee_id",
      "summary",
      "themes",
      "evidence_activity_ids",
      "format",
      "format_reason",
      "published_ids",
      "announcement_activity_ids",
    ],
    additionalProperties: false,
  },
};

export function searchCards(input: Input) {
  const query = str(input.query) ?? "";
  const filter = (input.filter && typeof input.filter === "object" ? input.filter : {}) as CardFilter;
  const terms = query
    .split(/[\s　、,]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const emps = new Map(employees().map((e) => [e.id, e]));
  const acts = new Map(activities().map((a) => [a.id, a]));
  const cards = filterCards(loadCards(), filter);
  const scored = cards
    .map((c) => {
      const e = emps.get(c.employee_id);
      const themes = c.themes.join(" ").toLowerCase();
      const summary = c.summary.toLowerCase();
      const tags = (e?.expertise_tags ?? []).join(" ").toLowerCase();
      const ev = c.evidence_activity_ids.map((id) => acts.get(id)?.title ?? "").join(" ").toLowerCase();
      let score = terms.length ? 0 : 1;
      for (const t of terms) {
        if (themes.includes(t)) score += 3;
        else if (summary.includes(t)) score += 2;
        else if (tags.includes(t) || ev.includes(t)) score += 1;
      }
      if (score > 0 && c.reviewed) score += 1; // reviewed cards first among equals
      return { c, e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.c.latest_activity_date > a.c.latest_activity_date ? 1 : -1));
  return {
    total_cards: cards.length,
    total_hits: scored.length,
    results: scored.slice(0, SEARCH_LIMIT).map(({ c, e, score }) => ({
      card_id: c.card_id,
      employee: `${c.employee_id} ${e?.name ?? ""}`,
      unit: e?.business_unit,
      talks: e?.past_talk_count,
      workload: e?.workload,
      themes: c.themes,
      summary: clip(c.summary, 120),
      evidence_activity_ids: c.evidence_activity_ids,
      published_ids: c.published_ids,
      format: c.format,
      publication_status: c.publication_status,
      reviewed: c.reviewed,
      latest_activity_date: c.latest_activity_date,
      outreach: outreachSummary(c),
      score,
    })),
  };
}

export function getCard(input: Input) {
  const id = str(input.card_id) ?? "";
  const c = getCardById(id);
  if (!c) return { error: `カード ${id} は見つかりません` };
  const acts = new Map(activities().map((a) => [a.id, a]));
  const pubs = new Map(published().map((p) => [p.id, p]));
  const e = employeeById(c.employee_id);
  return {
    ...c,
    employee: e ? `${e.id} ${e.name}｜${e.business_unit}｜忙しさ${e.workload}｜登壇${e.past_talk_count}回｜最終登壇 ${e.last_talk_date ?? "なし"}` : c.employee_id,
    evidence: c.evidence_activity_ids.map((id) => {
      const a = acts.get(id);
      return a ? `${a.id} ${a.date} [${a.type}] ${a.title}` : id;
    }),
    published: c.published_ids.map((id) => {
      const p = pubs.get(id);
      return p ? `${p.id} ${p.published_at.slice(0, 10)} ${p.genre} ${p.title}` : id;
    }),
  };
}

/** Tools for proposals: notebook first, then the raw activities. upsert_card is not included. */
export const PROPOSAL_TOOLS: Anthropic.Tool[] = [SEARCH_CARDS_DEF, GET_CARD_DEF, ...BASE_TOOL_DEFS];

const IMPL: Record<string, (input: Input) => unknown> = {
  search_cards: searchCards,
  get_card: getCard,
  search_activities: searchActivities,
  list_employees: listEmployees,
  get_employee: getEmployee,
  get_speaking_history: getSpeakingHistory,
  check_schedule: checkSchedule,
  get_published: getPublished,
};

export function executeTool(name: string, input: unknown): { ok: boolean; result: unknown } {
  const fn = IMPL[name];
  if (!fn) return { ok: false, result: { error: `unknown tool: ${name}` } };
  try {
    const args = input && typeof input === "object" ? (input as Input) : {};
    return { ok: true, result: fn(args) };
  } catch (e) {
    return { ok: false, result: { error: e instanceof Error ? e.message : String(e) } };
  }
}
