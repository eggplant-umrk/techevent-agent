// カード（ネタ）→ 出し先を探す。「依頼 → 人を探す」の逆向き。
// 新しい仕組みは作らず、Agentのループ（runToolLoop）・候補の出し方（自信のある／条件付き）・
// 内部の言葉の判定・日付の判定・ブログ提案・声かけ文の仕組みを使い回す。
import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { runToolLoop, type AgentEvent } from "./agent";
import { suggestBlogIdeas, type BlogIdea } from "./blog";
import { getCardById, type Card } from "./cards";
import { TODAY, TRENDS } from "./config";
import { activities, employeeById } from "./data";
import { dateProblems } from "./dates";
import {
  deadlineDate,
  externalEventById,
  isClosed,
  loadExternalEvents,
  requiredCautions,
  searchExternalEvents,
  themesOf,
  type ExternalEvent,
} from "./externalEvents";
import { internalTermProblems, PLAIN_TEXT_RULE } from "./plainText";
import { executeTool, toolDef } from "./tools";
import { getPerson, INTENT_LABEL, ngHits } from "./people";
import { chooseModels, runUsd, totalUsd } from "./usage";

// ---------------------------------------------------------------------------
// ツール
// ---------------------------------------------------------------------------
export const SEARCH_EXTERNAL_EVENTS_DEF: Anthropic.Tool = {
  name: "search_external_events",
  description:
    "社外の技術イベント（CFPのある登壇先）を、手元のデータから探す。外部サイトにはアクセスしない。queryはテーマの言葉（スペース区切り、空なら全件）、from/to は開催日の期間（YYYY-MM-DD、開催日が未定のものは期間に関係なく出る）。can_apply=false は締切済みで出し先にできない。",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "テーマの言葉（スペース区切り）" },
      from: { type: "string", description: "この日以降に開催（YYYY-MM-DD）。省略可" },
      to: { type: "string", description: "この日までに開催（YYYY-MM-DD）。省略可" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export const SUBMIT_VENUES = "submit_venues";

const SUBMIT_VENUES_DEF: Anthropic.Tool = {
  name: SUBMIT_VENUES,
  description:
    "最終回答。このネタの出し先（社外イベント）を最大3件、おすすめ順に出す。これを呼んだら作業は終わり。締切済みのイベントは出さない。合うものが1件もなければ venues を空にして no_fit を書く。",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "このネタの読み取りと、出し先の選び方の要約（2〜3文）" },
      no_fit: {
        type: ["object", "null"],
        description: "合う出し先が1件もないときだけ書く。1件以上あればnull",
        properties: {
          reasons: { type: "array", items: { type: "string" }, description: "合う出し先が見つからない理由" },
          next_checks: { type: "array", items: { type: "string" }, description: "技術広報が次に確かめること" },
        },
        required: ["reasons", "next_checks"],
        additionalProperties: false,
      },
      venues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            event_id: { type: "string" },
            theme: { type: "string", description: "そのイベント向けの発表タイトル案（カードのテーマ案を合わせて調整してよい）" },
            reason: { type: "string", description: "このイベントをすすめる理由を1行で（テーマ・聴衆・形式の合い方）" },
            evidence_activity_ids: {
              type: "array",
              items: { type: "string" },
              description: "根拠：カードのもとになった活動の id（カードの根拠から選ぶ）",
            },
            cautions: {
              type: "array",
              items: { type: "string" },
              description: "注意点（締切が近い、テーマが少しずれる、本人の予定が重なる など）",
            },
            confidence: { type: "string", enum: ["strong", "conditional"] },
            caveat: {
              type: ["string", "null"],
              description: "conditional のとき必須。何が引っかかるかを1文で。strong ならnull",
            },
          },
          required: ["event_id", "theme", "reason", "evidence_activity_ids", "cautions", "confidence", "caveat"],
          additionalProperties: false,
        },
      },
    },
    required: ["summary", "no_fit", "venues"],
    additionalProperties: false,
  },
};

const VENUE_TOOLS: Anthropic.Tool[] = [
  SEARCH_EXTERNAL_EVENTS_DEF,
  toolDef("get_card"),
  toolDef("check_schedule"),
  toolDef("get_published"),
  toolDef("get_speaking_history"),
  SUBMIT_VENUES_DEF,
];

// ---------------------------------------------------------------------------
// 指示文（毎回同じ。プロンプトキャッシュの対象）
// ---------------------------------------------------------------------------
const SYSTEM = `あなたはLayerXの技術広報を支えるAgentです。ネタ帳のカード1枚（社内の誰かの取り組み）について、社外で発表できる出し先（CFPのある技術イベント）を探します。これは「依頼が来てから人を探す」の逆向きで、ネタが先です。

今日は${TODAY}です。今の時流：${TRENDS.join("／")}

# 進め方
1. カードの中身（取り組み・テーマ案・根拠）と本人の状況を確かめる。get_card・get_speaking_history・get_published を必要に応じて使う
2. search_external_events でテーマの言葉を変えながら出し先を探す。外部サイトにはアクセスできない。手元のデータにあるものだけが出し先になる
3. 開催日が決まっているものは check_schedule で本人の予定と重ならないか確かめる
4. 最大3件をおすすめ順に並べ、submit_venues を呼んで終わる

# 判断基準
- 締切済み（can_apply=false）は出さない
- テーマ・聴衆・形式が取り組みの中身と合うかで選ぶ。合うものがなければ無理に出さず、no_fit に見つからない理由と次に確かめることを書く
- 自信のある出し先は confidence=strong、テーマが少しずれる・締切がすぐ・予定が重なるなど引っかかる点があれば confidence=conditional にして caveat に1文で書く。strong を先に並べる
- 根拠は、カードのもとになった活動の id だけ（カードの根拠から選ぶ）
- cfp_status が unknown のものは締切が公式で未確認、event_date が null のものは開催日が未定。どちらも出してよいが、そのことを踏まえて書く（注意点はシステムが必ず足す）
- 応募するのは本人。あなたは出し先を提案するところまで
- カードの person（技術広報が確認済みの人の情報）に従う。登壇の意向が「今は控えたい」なら出し先は conditional にして caveat にそのことを書く。NGのテーマに当たるタイトル案にしない
- ${PLAIN_TEXT_RULE}。idは event_id や evidence_activity_ids の項目にだけ書き、文の中には書かない`;

// ---------------------------------------------------------------------------
// 結果の形
// ---------------------------------------------------------------------------
export interface VenueSubmit {
  summary: string;
  no_fit: { reasons: string[]; next_checks: string[] } | null;
  venues: Array<{
    event_id: string;
    theme: string;
    reason: string;
    evidence_activity_ids: string[];
    cautions: string[];
    confidence: "strong" | "conditional";
    caveat: string | null;
  }>;
}

export interface VenueCard {
  rank: number;
  event_id: string;
  name: string;
  url: string;
  cfp_url: string | null;
  event_date: string | null;
  cfp_status: ExternalEvent["cfp_status"];
  cfp_deadline: string | null;
  format: string[];
  location: string | null;
  theme: string;
  reason: string;
  cautions: string[];
  evidence: Array<{ id: string; type: string; date: string; title: string }>;
  confidence: "strong" | "conditional";
  caveat: string | null;
  checked_at: string;
}

export interface VenueResult {
  run_id: string;
  card_id: string;
  employee_id: string;
  employee_name: string;
  summary: string;
  venues: VenueCard[];
  no_fit: VenueSubmit["no_fit"];
  /** 既存のブログ提案（このカード1枚から）。発信済みなどで出せないときは null と理由 */
  blog: BlogIdea | null;
  blog_note: string | null;
}

// ---------------------------------------------------------------------------
// 検証（コード）
// ---------------------------------------------------------------------------
export function validateVenues(input: VenueSubmit, card: Card, today = TODAY): string[] {
  const errs: string[] = [];
  const vs = Array.isArray(input.venues) ? input.venues : [];
  if (vs.length > 3) errs.push("出し先は3件までにしてください");
  if (vs.length === 0 && (!input.no_fit || input.no_fit.reasons.length === 0)) {
    errs.push("出し先が1件もないときは no_fit に見つからない理由と次に確かめることを書いてください");
  }
  const allEvents = loadExternalEvents();
  const ids = new Set<string>();
  let seenConditional = false;
  for (const v of vs) {
    const e = externalEventById(v.event_id);
    if (!e) {
      errs.push(`イベント ${v.event_id} は存在しません。search_external_events で見たものだけを出してください`);
      continue;
    }
    if (ids.has(v.event_id)) errs.push(`${e.name} が重複しています`);
    ids.add(v.event_id);
    if (isClosed(e, today)) errs.push(`${e.name} は締切済み（応募が締め切られている、または締切が今日より前）なので出せません`);
    if (v.confidence === "conditional") {
      seenConditional = true;
      if (!v.caveat?.trim()) errs.push(`${e.name} は条件付きなので、caveat に何が引っかかるかを1文で書いてください`);
    }
    if (v.confidence === "strong" && seenConditional) errs.push("自信のある出し先（strong）を、条件付き（conditional）より先に並べてください");
    const person = getPerson(card.employee_id);
    if (person?.speaking_intent === "hold" && v.confidence !== "conditional") errs.push(`${person.name}さんは登壇の意向が「今は控えたい」なので、出し先は条件付きにして、引っかかる点にそのことを書いてください`);
    const ng = person ? ngHits(v.theme, person.ng_themes) : [];
    if (ng.length) errs.push(`${e.name} のタイトル案が、本人のNGのテーマ「${ng.join("」「")}」に当たります`);
    const bad = (v.evidence_activity_ids ?? []).filter((id) => !card.evidence_activity_ids.includes(id));
    if (bad.length) errs.push(`${e.name} の根拠 ${bad.join(", ")} はこのカードの根拠ではありません。カードのもとになった活動の id を使ってください`);
    if (!v.evidence_activity_ids?.length && card.evidence_activity_ids.length) errs.push(`${e.name} の根拠（カードのもとになった活動の id）がありません`);
    // 日付：開催日が決まっているものだけ確かめる（null は対象外）
    const others = allEvents.filter((x) => x.id !== e.id && x.event_date).map((x) => x.event_date!);
    for (const t of [v.reason, v.caveat ?? "", ...v.cautions]) {
      for (const p of dateProblems(t, e.event_date ?? undefined, others)) errs.push(`${e.name} の注意点：${p}`);
    }
  }
  errs.push(
    ...internalTermProblems([
      { where: "summary", text: input.summary },
      ...(input.no_fit?.reasons ?? []).map((t) => ({ where: "no_fit.reasons", text: t })),
      ...(input.no_fit?.next_checks ?? []).map((t) => ({ where: "no_fit.next_checks", text: t })),
      ...vs.flatMap((v) => [
        { where: `${v.event_id} の theme`, text: v.theme },
        { where: `${v.event_id} の reason`, text: v.reason },
        { where: `${v.event_id} の caveat`, text: v.caveat },
        ...v.cautions.map((t) => ({ where: `${v.event_id} の cautions`, text: t })),
      ]),
    ]),
  );
  return errs;
}

function buildVenues(input: VenueSubmit, card: Card): VenueCard[] {
  const acts = new Map(activities().map((a) => [a.id, a]));
  return input.venues.map((v, i) => {
    const e = externalEventById(v.event_id)!;
    // 必ず付ける注意点（締切は公式で要確認・開催日は要確認・締切が近い・本人の予定）は、決まった文のまま必ず入れる
    const required = [
      ...requiredCautions(e, card.employee_id),
      ...(getPerson(card.employee_id)?.speaking_intent === "hold" ? ["本人は今は登壇を控えたい意向（技術広報が確認済み）"] : []),
    ];
    const cautions = [...required, ...v.cautions.filter((c) => !required.includes(c))];
    return {
      rank: i + 1,
      event_id: e.id,
      name: e.name,
      url: e.url,
      cfp_url: e.cfp_url,
      event_date: e.event_date,
      cfp_status: e.cfp_status,
      cfp_deadline: deadlineDate(e),
      format: e.format,
      location: e.location,
      theme: v.theme,
      reason: v.reason,
      cautions,
      evidence: v.evidence_activity_ids
        .map((id) => acts.get(id))
        .filter((a): a is NonNullable<typeof a> => !!a)
        .map((a) => ({ id: a.id, type: a.type, date: a.date, title: a.title })),
      confidence: v.confidence,
      caveat: v.confidence === "conditional" ? v.caveat!.trim() : null,
      checked_at: e.checked_at,
    };
  });
}

function summarize(name: string, out: unknown): string {
  const r = out as Record<string, unknown>;
  if (r && typeof r === "object" && "error" in r) return `エラー: ${String(r.error)}`;
  if (name === "search_external_events") {
    const rs = (r.results as Array<{ name: string; can_apply: boolean }>) ?? [];
    const open = rs.filter((x) => x.can_apply).length;
    return `${r.hits}件（応募できるもの ${open}件）／上位: ${rs.slice(0, 3).map((x) => `${x.name}${x.can_apply ? "" : "（締切済み）"}`).join("、")}`;
  }
  if (name === "get_card") return `カードを確認：根拠${(r.evidence as unknown[])?.length ?? 0}件`;
  if (name === "check_schedule") return r.conflict ? "予定が重なる" : "予定の重なりなし";
  if (name === "get_published") return `発信済み ${r.count}件`;
  if (name === "get_speaking_history") return `登壇${r.past_talk_count}回、最終 ${r.last_talk_date ?? "なし"}`;
  return "ok";
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
export type VenueEvent = AgentEvent | { type: "venue_final"; result: VenueResult };

export async function findVenues(cardId: string, emit: (e: VenueEvent) => void): Promise<VenueResult | null> {
  const card = getCardById(cardId);
  if (!card) throw new Error(`カード ${cardId} は存在しません`);
  const emp = employeeById(card.employee_id);
  const runId = randomUUID();
  const models = chooseModels();
  emit({ type: "start", run_id: runId, loop_model: models.loop, heavy_model: models.heavy, switched: models.switched, total_usd: models.totalUsd, switch_usd: models.switchUsd });

  const acts = new Map(activities().map((a) => [a.id, a]));
  const cardText = {
    card_id: card.card_id,
    employee: emp ? `${emp.id} ${emp.name}｜${emp.business_unit}｜${emp.role}｜登壇${emp.past_talk_count}回｜忙しさ${emp.workload}` : card.employee_id,
    summary: card.summary,
    themes: card.themes,
    format: card.format,
    publication_status: card.publication_status,
    person: (() => {
      const p = getPerson(card.employee_id);
      return p ? { speaking_intent: INTENT_LABEL[p.speaking_intent], ng_themes: p.ng_themes } : null;
    })(),
    evidence: card.evidence_activity_ids.map((id) => {
      const a = acts.get(id);
      return a ? `${a.id} ${a.date} ${a.title}：${a.body}` : id;
    }),
  };

  const { submitted, steps } = await runToolLoop<VenueSubmit>(
    {
      runId,
      model: models.loop,
      system: SYSTEM,
      tools: VENUE_TOOLS,
      firstMessage: `次のカードのネタについて、社外の出し先を最大3件探してください。\n\n${JSON.stringify(cardText, null, 2)}`,
      submitTool: SUBMIT_VENUES,
      validate: (input) => validateVenues(input, card),
      submittedSummary: (input) => (input.venues.length ? `出し先${input.venues.length}件を提出` : "合う出し先なしで提出"),
      runTool: (name, input) => {
        const out =
          name === "search_external_events"
            ? { ok: true, result: searchExternalEvents((input ?? {}) as { query?: string; from?: string; to?: string }) }
            : executeTool(name, input);
        return { ...out, summary: summarize(name, out.result) };
      },
    },
    emit,
  );

  if (!submitted) {
    emit({ type: "error", message: "上限までに出し先を出せませんでした" });
    emit({ type: "done", run_usd: runUsd(runId), total_usd: totalUsd(), steps });
    return null;
  }

  // ブログ案：既存のブログ提案を、このカード1枚に絞って使い回す
  let blog: BlogIdea | null = null;
  let blogNote: string | null = null;
  if (card.publication_status !== "unpublished") {
    blogNote = "このネタはすでに発信済みのため、ブログ案は出していません";
  } else {
    try {
      const r = await suggestBlogIdeas({ cardIds: [card.card_id], count: 1, runId });
      blog = r.ideas[0] ?? null;
      if (!blog) blogNote = "ブログ案を作れませんでした";
    } catch (e) {
      blogNote = `ブログ案を作れませんでした（${e instanceof Error ? e.message : "不明なエラー"}）`;
    }
  }

  const result: VenueResult = {
    run_id: runId,
    card_id: card.card_id,
    employee_id: card.employee_id,
    employee_name: emp?.name ?? card.employee_id,
    summary: submitted.summary,
    venues: buildVenues(submitted, card),
    no_fit: submitted.venues.length === 0 ? submitted.no_fit : null,
    blog,
    blog_note: blogNote,
  };
  emit({ type: "venue_final", result });
  emit({ type: "done", run_usd: runUsd(runId), total_usd: totalUsd(), steps });
  return result;
}

export { themesOf };
