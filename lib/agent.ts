// The agent loop: Claude API tool use, up to MAX_STEPS model calls.
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { getClient } from "./anthropic";
import { MAX_STEPS, TODAY } from "./config";
import { activities, employeeById, schedules, type SpeakingRequest } from "./data";
import { alternativePitch } from "./heavy";
import { buildSystemPrompt } from "./prompt";
import { executeTool, PROPOSAL_TOOLS, SUBMIT_TOOL, type SubmitInput } from "./tools";
import { chooseModels, recordUsage, runUsd, totalUsd } from "./usage";
import { getCardById, type Card } from "./cards";

export type AgentEvent =
  | { type: "start"; run_id: string; loop_model: string; heavy_model: string; switched: boolean; total_usd: number; switch_usd: number }
  | { type: "step"; n: number; max: number }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "usage"; run_usd: number; total_usd: number; cache_read: number; input: number; output: number }
  | { type: "retry"; message: string }
  | { type: "final"; result: ProposalResult }
  | { type: "alternative_pitch"; text: string; model: string; fell_back: boolean }
  | { type: "error"; message: string }
  | { type: "done"; run_usd: number; total_usd: number; steps: number };

export interface CandidateCard {
  rank: number;
  employee_id: string;
  name: string;
  business_unit: string;
  role: string;
  workload: number;
  past_talk_count: number;
  last_talk_date: string | null;
  theme: string;
  reason: string;
  evidence: Array<{ id: string; type: string; date: string; title: string; where: string | null }>;
  cautions: string[];
  is_alternative_to_nominee: boolean;
  card_id: string | null;
  /** Snapshot of the notebook card at proposal time (null if the agent proposed someone without a card). */
  card: Card | null;
}

export interface ProposalResult {
  run_id: string;
  request_id: string;
  request_pattern: SubmitInput["request_pattern"];
  summary: string;
  nominee_assessment: string | null;
  learnings_applied: string[];
  no_fit: SubmitInput["no_fit"];
  candidates: CandidateCard[];
  alternative_pitch?: string;
}

const SYSTEM_PROMPT_CACHE: { text?: string } = {};
function systemPrompt() {
  // Built once per process so the bytes never change between steps.
  return (SYSTEM_PROMPT_CACHE.text ??= buildSystemPrompt());
}

export function requestForAgent(r: SpeakingRequest) {
  // Only fields a real request would carry. note_for_demo is already stripped by data.requests().
  return {
    id: r.id,
    received_at: r.received_at,
    requester: r.requester,
    event: r.event,
    theme: r.theme ?? null,
    nominated_employee_id: r.nominated_employee_id ?? null,
    nominated_employee_name: r.nominated_employee_id ? employeeById(r.nominated_employee_id)?.name : undefined,
    reference: r.reference ?? null,
    reply_deadline: r.reply_deadline,
    message: r.message,
  };
}

function summarize(name: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (r && typeof r === "object" && "error" in r) return `エラー: ${String(r.error)}`;
  switch (name) {
    case "search_cards": {
      const rs = (r.results as Array<{ card_id: string; employee: string; themes: string[]; reviewed: boolean }>) ?? [];
      return (
        `ネタ帳 ${r.total_hits}枚ヒット／上位: ` +
        rs
          .slice(0, 3)
          .map((x) => `${x.employee.split(" ")[1] ?? x.employee}${x.reviewed ? "（確認済み）" : ""}「${x.themes[0]}」`)
          .join("、")
      );
    }
    case "get_card": {
      const h = (r.outreach_history as unknown[]) ?? [];
      return `${r.card_id}：根拠${(r.evidence as unknown[]).length}件／打診履歴${h.length}件${r.reviewed ? "／確認済み" : ""}`;
    }
    case "search_activities": {
      const rs = (r.results as Array<{ id: string; author: string; title: string }>) ?? [];
      return `${r.total_hits}件ヒット／上位: ` + rs.slice(0, 3).map((x) => `${x.author.split(" ")[1] ?? x.author}「${x.title}」`).join("、");
    }
    case "list_employees":
      return `${(result as unknown[]).length}人`;
    case "get_employee":
      return `${r.name}／忙しさ${r.workload}／登壇${r.past_talk_count}回／発信${r.published_count}件`;
    case "get_speaking_history":
      return `${r.name}：登壇${r.past_talk_count}回、最終 ${r.last_talk_date ?? "なし"}`;
    case "check_schedule":
      return r.conflict ? `予定が重なる（${(r.nearby as Array<{ kind: string }>).map((x) => x.kind).join("、")}）` : (r.nearby as unknown[]).length ? "前後に予定あり（当日は空き）" : "予定の重なりなし";
    case "get_published":
      return `発信済み ${r.count}件`;
    default:
      return "ok";
  }
}

/** Activity ids the agent has actually seen in tool results this run. */
function collectSeenIds(name: string, result: unknown, seen: Set<string>) {
  if (name === "search_activities") {
    for (const x of ((result as { results?: Array<{ id: string }> }).results ?? [])) seen.add(x.id);
  }
  if (name === "get_employee") {
    for (const t of ((result as { recent_activity_titles?: string[] }).recent_activity_titles ?? [])) seen.add(t.split(" ")[0]);
  }
  if (name === "search_cards") {
    for (const x of ((result as { results?: Array<{ evidence_activity_ids: string[] }> }).results ?? [])) {
      for (const id of x.evidence_activity_ids) seen.add(id);
    }
  }
  if (name === "get_card") {
    for (const t of ((result as { evidence?: string[] }).evidence ?? [])) seen.add(t.split(" ")[0]);
  }
}

function validateSubmit(input: SubmitInput, seen: Set<string>): string[] {
  const errs: string[] = [];
  const n = Array.isArray(input.candidates) ? input.candidates.length : 0;
  if (n > 3) errs.push("候補は3人までにしてください");
  if (n < 3 && (!input.no_fit || input.no_fit.reasons.length === 0)) {
    errs.push("候補が3人に満たないときは no_fit に「見つからない理由」と「次に確認すべきこと」を書いてください");
  }
  const acts = new Map(activities().map((a) => [a.id, a]));
  const ids = new Set<string>();
  for (const c of input.candidates ?? []) {
    if (!employeeById(c.employee_id)) errs.push(`${c.employee_id} は社員一覧にいません`);
    if (ids.has(c.employee_id)) errs.push(`${c.employee_id} が重複しています`);
    ids.add(c.employee_id);
    const card = c.card_id ? getCardById(c.card_id) : undefined;
    if (c.card_id && !card) errs.push(`カード ${c.card_id} は存在しません`);
    if (card && card.employee_id !== c.employee_id) errs.push(`カード ${c.card_id} は ${c.employee_id} のカードではありません`);
    const publishedOnly = !!card && card.evidence_activity_ids.length === 0 && card.published_ids.length > 0;
    if (!c.evidence_activity_ids?.length && !publishedOnly) errs.push(`${c.employee_id} の根拠の取り組みがありません`);
    for (const id of c.evidence_activity_ids ?? []) {
      if (!acts.has(id)) errs.push(`根拠 ${id} は存在しない activity id です`);
      else if (!seen.has(id)) errs.push(`${c.employee_id} の根拠 ${id} はこの調査で見ていない取り組みです。カードか検索結果で確認したIDだけを使ってください`);
    }
  }
  return errs;
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Cautions computed from data, added to the agent's own so the 3 decline reasons are always visible. */
function systemCautions(employeeId: string, eventDate: string | undefined): string[] {
  const e = employeeById(employeeId);
  if (!e) return [];
  const out: string[] = [];
  if (e.last_talk_date && daysBetween(e.last_talk_date, TODAY) <= 180) out.push(`最近登壇した（${e.last_talk_date}）`);
  if (e.workload >= 4) out.push(`忙しい（忙しさ${e.workload}）`);
  if (eventDate) {
    const hit = schedules().find((s) => s.employee_id === employeeId && s.from <= eventDate && s.to >= eventDate);
    if (hit) out.push(`予定が重なる（${hit.kind} ${hit.from}〜${hit.to}）`);
  }
  return out;
}

function buildResult(runId: string, request: SpeakingRequest, input: SubmitInput): ProposalResult {
  const acts = new Map(activities().map((a) => [a.id, a]));
  return {
    run_id: runId,
    request_id: request.id,
    request_pattern: input.request_pattern,
    summary: input.summary,
    nominee_assessment: input.nominee_assessment,
    learnings_applied: input.learnings_applied,
    no_fit: input.candidates.length < 3 ? input.no_fit : null,
    candidates: input.candidates.map((c, i) => {
      const e = employeeById(c.employee_id)!;
      const sys = systemCautions(c.employee_id, request.event?.date);
      const cautions = [...c.cautions];
      for (const s of sys) if (!cautions.some((x) => x.includes(s.slice(0, 4)))) cautions.push(s);
      return {
        rank: i + 1,
        employee_id: e.id,
        name: e.name,
        business_unit: e.business_unit,
        role: e.role,
        workload: e.workload,
        past_talk_count: e.past_talk_count,
        last_talk_date: e.last_talk_date,
        theme: c.theme,
        reason: c.reason,
        evidence: c.evidence_activity_ids
          .map((id) => acts.get(id))
          .filter((a): a is NonNullable<typeof a> => !!a)
          .map((a) => ({ id: a.id, type: a.type, date: a.date, title: a.title, where: a.channel ?? a.repo })),
        cautions,
        is_alternative_to_nominee: c.is_alternative_to_nominee,
        card_id: c.card_id,
        card: c.card_id ? getCardById(c.card_id) ?? null : null,
      };
    }),
  };
}

export async function runAgent(
  request: SpeakingRequest,
  emit: (e: AgentEvent) => void,
  opts: { withAlternativePitch?: boolean } = {},
): Promise<ProposalResult | null> {
  const client = getClient();
  const runId = randomUUID();
  const models = chooseModels();
  emit({
    type: "start",
    run_id: runId,
    loop_model: models.loop,
    heavy_model: models.heavy,
    switched: models.switched,
    total_usd: models.totalUsd,
    switch_usd: models.switchUsd,
  });

  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: systemPrompt(), cache_control: { type: "ephemeral" } }];
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `次の登壇依頼に対して、ネタ帳から候補を最大3人提案してください。\n\n${JSON.stringify(requestForAgent(request), null, 2)}`,
    },
  ];
  const seen = new Set<string>();
  let result: ProposalResult | null = null;
  let step = 0;

  for (step = 1; step <= MAX_STEPS; step++) {
    emit({ type: "step", n: step, max: MAX_STEPS });
    const res = await client.messages.create({
      model: models.loop,
      max_tokens: 16000,
      system,
      tools: PROPOSAL_TOOLS,
      messages,
      cache_control: { type: "ephemeral" }, // auto-caches the growing conversation prefix
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
    });
    const u = recordUsage(runId, "loop", res.model, res.usage);
    emit({
      type: "usage",
      run_usd: runUsd(runId),
      total_usd: totalUsd(),
      cache_read: u.cache_read_input_tokens,
      input: u.input_tokens + u.cache_creation_input_tokens,
      output: u.output_tokens,
    });

    for (const b of res.content) {
      if (b.type === "thinking" && b.thinking.trim()) emit({ type: "thinking", text: b.thinking });
      if (b.type === "text" && b.text.trim()) emit({ type: "text", text: b.text });
    }

    if (res.stop_reason === "refusal") {
      emit({ type: "error", message: "モデルがこの依頼の処理を断りました" });
      break;
    }

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    messages.push({ role: "assistant", content: res.content });

    if (toolUses.length === 0) {
      messages.push({ role: "user", content: `${SUBMIT_TOOL} を呼んで最終回答を出してください。` });
      continue;
    }
    if (res.stop_reason === "max_tokens") {
      emit({ type: "error", message: "出力が長すぎて途中で切れました" });
      break;
    }

    const results: Anthropic.ToolResultBlockParam[] = [];
    let submitted: SubmitInput | null = null;
    for (const t of toolUses) {
      emit({ type: "tool_call", id: t.id, name: t.name, input: t.input });
      if (t.name === SUBMIT_TOOL) {
        const input = t.input as SubmitInput;
        const errs = validateSubmit(input, seen);
        if (errs.length) {
          emit({ type: "retry", message: errs.join("／") });
          emit({ type: "tool_result", id: t.id, name: t.name, ok: false, summary: "差し戻し：" + errs.join("／") });
          results.push({ type: "tool_result", tool_use_id: t.id, is_error: true, content: errs.join("\n") });
        } else {
          submitted = input;
          emit({ type: "tool_result", id: t.id, name: t.name, ok: true, summary: `候補${input.candidates.length}人を提出` });
          results.push({ type: "tool_result", tool_use_id: t.id, content: "受け付けました" });
        }
        continue;
      }
      const { ok, result: out } = executeTool(t.name, t.input);
      collectSeenIds(t.name, out, seen);
      emit({ type: "tool_result", id: t.id, name: t.name, ok, summary: summarize(t.name, out) });
      results.push({ type: "tool_result", tool_use_id: t.id, is_error: !ok || undefined, content: JSON.stringify(out) });
    }

    if (submitted) {
      result = buildResult(runId, request, submitted);
      break;
    }

    const content: Anthropic.ContentBlockParam[] = [...results];
    if (step === MAX_STEPS - 1) {
      content.push({ type: "text", text: `残り1回です。次の応答で必ず ${SUBMIT_TOOL} を呼んでください。` });
    }
    messages.push({ role: "user", content });
  }

  if (!result) {
    emit({ type: "error", message: `上限（${MAX_STEPS}回）までに候補を出せませんでした` });
    emit({ type: "done", run_usd: runUsd(runId), total_usd: totalUsd(), steps: Math.min(step, MAX_STEPS) });
    return null;
  }

  // Named-speaker requests: the heavy model writes why to propose the alternative.
  const alts = result.candidates.filter((c) => c.is_alternative_to_nominee);
  if (opts.withAlternativePitch !== false && request.nominated_employee_id && alts.length) {
    try {
      const pitch = await alternativePitch(runId, request, result.nominee_assessment, alts);
      result.alternative_pitch = pitch.value;
      emit({ type: "alternative_pitch", text: pitch.value, model: pitch.model, fell_back: pitch.fellBack });
    } catch (e) {
      emit({ type: "error", message: `代わりの人を推す理由を作れませんでした：${e instanceof Error ? e.message : String(e)}` });
    }
  }

  emit({ type: "final", result });
  emit({ type: "done", run_usd: runUsd(runId), total_usd: totalUsd(), steps: step });
  return result;
}
