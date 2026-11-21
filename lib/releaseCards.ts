// リリースノートを「チームのネタ」としてカードにする（ネタ帳の更新とは別の流れ）。
//   - まだカードになっていないリリースノートだけを、AI への1回の呼び出し（差し戻しがあれば最大3回）でまとめて読む
//   - 担当者が分かるもの → その人の新しいカード（既存のカードは更新しない）
//   - 担当者がいないもの → 同じ機能に触れている活動をキーワード一致で探し（コード）、候補がいれば AI が最後の判断をする。
//     AI の選んだ人は lib/releaseNotes.ts の checkMatch で確かめる。決まらなければ「担当者未定のネタ」（data/unassigned_cards.json）
//   - 技術広報が担当者を割り当てたら、その人の普通のカードになり、確認済みとして扱う（Agent は上書きしない）
// リリースノート自体は「発信済み」ではない（published_ids・告知は空）。根拠はリリースノートの id（公開ページの URL つき）。
import type Anthropic from "@anthropic-ai/sdk";
import { todayJst, nowJst } from "./clock";
import { randomUUID } from "node:crypto";
import { getClient } from "./anthropic";
import { editCard, loadCards, upsertCard, type CardFormat } from "./cards";
import { TRENDS } from "./config";
import { activities, employeeById, employees } from "./data";
import { internalTermProblems, PLAIN_TEXT_RULE } from "./plainText";
import {
  checkMatch,
  ownerCandidates,
  ownerOf,
  ownerRecords,
  releaseNotes,
  saveOwnerRecords,
  saveUnassignedCards,
  unassignedCards,
  type OwnerCandidate,
  type ReleaseNote,
  type UnassignedCard,
} from "./releaseNotes";
import { chooseModels, recordUsage, runUsd, totalUsd } from "./usage";

const SUBMIT = "submit_release_cards";
const MAX_CALLS = 3;

export interface PendingNote {
  note: ReleaseNote;
  /** 担当者（データ・割り当て・これまでの判断で決まっている人）。いなければ null */
  owner: string | null;
  /** 担当者がいないときだけ：同じ機能に触れている活動を持つ人（キーワード一致） */
  candidates: OwnerCandidate[];
}

/** まだカード（担当者未定のネタを含む）になっていないリリースノート */
export function pendingReleaseNotes(): PendingNote[] {
  const used = new Set<string>([
    ...loadCards().flatMap((c) => c.evidence_activity_ids),
    ...unassignedCards().flatMap((u) => u.release_note_ids),
  ]);
  const records = ownerRecords();
  const acts = activities();
  return releaseNotes()
    .filter((n) => !used.has(n.id))
    .map((note) => {
      const owner = ownerOf(note, records);
      return { note, owner, candidates: owner ? [] : ownerCandidates(note, acts) };
    });
}

interface SubmitItem {
  release_id: string;
  summary: string;
  themes: string[];
  format: CardFormat;
  format_reason: string;
  owner: { employee_id: string | null; evidence_activity_ids: string[]; reason: string };
}

const SUBMIT_DEF: Anthropic.Tool = {
  name: SUBMIT,
  description: "リリースノートごとのカードの中身と、担当者未定のものについての担当者の判断を、まとめて提出する。",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            release_id: { type: "string" },
            summary: { type: "string", description: "何を出したか・誰のどんな課題を解いたか。2〜3文。リリースノートにない数字や事実は足さない" },
            themes: { type: "array", items: { type: "string" }, description: "社外で話せる／書けるテーマ案。1〜3個、具体的に" },
            format: { type: "string", enum: ["talk", "lt", "blog"] },
            format_reason: { type: "string", description: "その形をすすめる理由を1文で" },
            owner: {
              type: "object",
              description:
                "担当者未定で、同じ機能に触れている活動の候補が示されたものだけ判断する。候補の活動が本当にこのリリースと同じ機能の仕事なら、その人と根拠の活動idを入れる。少しでも迷えば employee_id は null（推測で決めない）。それ以外のリリースノートは employee_id を null、根拠は空配列",
              properties: {
                employee_id: { type: ["string", "null"] },
                evidence_activity_ids: { type: "array", items: { type: "string" } },
                reason: { type: "string", description: "判断の理由を1文で" },
              },
              required: ["employee_id", "evidence_activity_ids", "reason"],
            },
          },
          required: ["release_id", "summary", "themes", "format", "format_reason", "owner"],
        },
      },
    },
    required: ["items"],
  },
};

function instructions(): string {
  return `あなたはLayerXの技術広報を支えるAgentです。プロダクトのリリースノートを読み、ネタ帳の「チームのネタ」のカードの中身を書きます。今日は${todayJst()}です。今の時流：${TRENDS.join("／")}

# カードの中身
- summary：そのリリースで何を出したか、誰のどんな課題を解いたかを2〜3文で。リリースノートにない数字・事実・社内事情は足さない
- themes：開発チームが社外で話せる／書けるテーマ案を1〜3個。「〇〇について」のような広いテーマにせず、作るときの工夫や判断が伝わる切り口にする（例：課題の見つけ方、AIに任せた範囲と人が確かめる範囲、既存の機能との連携の設計）
- format：talk（20分以上）／lt（5〜10分）／blog。リリースノートの中身の厚さから選び、format_reason に1文で理由
- リリースノートは製品のお知らせで、登壇やブログ（発信済み）ではない

# 担当者の判断（担当者未定のものだけ）
- 「同じ機能に触れている活動」の候補が示されたものだけ判断する。候補の活動が、このリリースと同じ機能・同じ課題の仕事だと読み取れるときだけ、その人を選び、根拠にした活動idを入れる
- 言葉が少し重なるだけ、別の製品の話、一般的な話なら選ばない（employee_id は null）。少しでも迷えば null。推測で人に付けない
- 担当者が決まっているもの・候補がないものは、employee_id を null、根拠は空配列にする

summary・themes・format_reason は技術広報が読む文です。${PLAIN_TEXT_RULE}。

渡されたリリースノートすべてについて、${SUBMIT} を1回だけ呼んで提出してください。文章だけで答えないでください。`;
}

function noteText(p: PendingNote): string {
  const n = p.note;
  const who = p.owner
    ? `担当者：決まっている（${employeeById(p.owner)?.name ?? p.owner}）`
    : p.candidates.length
      ? `担当者：未定。同じ機能に触れている活動の候補：\n${p.candidates
          .map((c) => {
            const acts = new Map(activities().map((a) => [a.id, a]));
            return `    - ${c.employee_id} ${employeeById(c.employee_id)?.name ?? ""}（一致した言葉：${c.matched_keywords.join("、")}）\n${c.activity_ids
              .map((id) => `        ${id}｜${acts.get(id)?.date}｜${acts.get(id)?.title}｜${acts.get(id)?.body.slice(0, 120)}`)
              .join("\n")}`;
          })
          .join("\n")}`
      : "担当者：未定（同じ機能に触れている活動は見つからなかった）";
  return `- ${n.id}｜${n.date}｜${n.product}｜${n.title}\n  ${n.summary}\n  ${who}`;
}

/** 提出の検査（コード）。空なら保存してよい */
export function validateReleaseSubmit(items: SubmitItem[], pending: PendingNote[]): string[] {
  const errs: string[] = [];
  const want = new Map(pending.map((p) => [p.note.id, p]));
  const seen = new Set<string>();
  for (const it of items ?? []) {
    const p = want.get(it.release_id);
    if (!p) {
      errs.push(`${it.release_id} は今回のリリースノートではありません`);
      continue;
    }
    if (seen.has(it.release_id)) errs.push(`${it.release_id} が重複しています`);
    seen.add(it.release_id);
    if (!it.summary?.trim()) errs.push(`${it.release_id} の summary が空です`);
    if (!Array.isArray(it.themes) || it.themes.length < 1 || it.themes.length > 3) errs.push(`${it.release_id} の themes は1〜3個にしてください`);
    if (!["talk", "lt", "blog"].includes(it.format)) errs.push(`${it.release_id} の format は talk / lt / blog のどれかです`);
    const o = it.owner ?? { employee_id: null, evidence_activity_ids: [], reason: "" };
    if (p.owner || !p.candidates.length) {
      if (o.employee_id) errs.push(`${it.release_id} は担当者を判断するリリースノートではありません。owner.employee_id は null にしてください`);
    } else {
      errs.push(...checkMatch(p.candidates, { employee_id: o.employee_id, evidence_activity_ids: o.evidence_activity_ids ?? [] }).map((e) => `${it.release_id}：${e}`));
    }
    errs.push(
      ...internalTermProblems([
        { where: `${it.release_id} の summary`, text: it.summary },
        { where: `${it.release_id} の themes`, text: (it.themes ?? []).join("\n") },
        { where: `${it.release_id} の format_reason`, text: it.format_reason },
      ]),
    );
  }
  for (const id of want.keys()) if (!seen.has(id)) errs.push(`${id} のカードがありません`);
  return errs;
}

export type ReleaseEvent =
  | { type: "start"; run_id: string; model: string; pending: number }
  | { type: "card"; release_id: string; card_id: string; employee_id: string; by: "data" | "human" | "match"; theme: string }
  | { type: "unassigned"; release_id: string; card_id: string; theme: string; reason: string }
  | { type: "rejected"; errors: string[] }
  | { type: "error"; message: string }
  | { type: "done"; run_usd: number; total_usd: number; cards: number; unassigned: number };

function nextTeamCardId(list: UnassignedCard[]): string {
  let i = list.length + 1;
  while (list.some((c) => c.card_id === `card-team-${String(i).padStart(2, "0")}`)) i++;
  return `card-team-${String(i).padStart(2, "0")}`;
}

/** 提出された中身を保存する（既存のカードは更新しない。新しいカードか、担当者未定のネタとして足す） */
export function saveReleaseItems(items: SubmitItem[], pending: PendingNote[], emit: (e: ReleaseEvent) => void = () => {}) {
  const byId = new Map(pending.map((p) => [p.note.id, p]));
  const records = ownerRecords();
  let cards = 0;
  let unassigned = 0;
  for (const it of items) {
    const p = byId.get(it.release_id)!;
    let owner = p.owner;
    let by: "data" | "human" | "match" = records[p.note.id]?.by === "human" ? "human" : p.note.owner_id ? "data" : "match";
    let matched: string[] = [];
    if (!owner && p.candidates.length) {
      // 候補があったものは、AI の判断（コードで確かめ済み）を残す。null なら「決まらなかった」
      records[p.note.id] = {
        employee_id: it.owner.employee_id,
        by: "match",
        matched_activity_ids: it.owner.employee_id ? it.owner.evidence_activity_ids : [],
        reason: it.owner.reason ?? "",
        at: nowJst(),
      };
      saveOwnerRecords(records);
      if (it.owner.employee_id) {
        owner = it.owner.employee_id;
        matched = it.owner.evidence_activity_ids;
        by = "match";
      }
    }
    if (owner) {
      const out = upsertCard({
        card_id: null, // いつも新しいカード（既存のカードは上書きしない）
        employee_id: owner,
        summary: it.summary,
        themes: it.themes,
        evidence_activity_ids: [p.note.id, ...matched],
        format: it.format,
        format_reason: it.format_reason,
        published_ids: [],
        announcement_activity_ids: [],
      });
      if (!out.ok) {
        emit({ type: "error", message: `${p.note.id} を保存できませんでした：${out.errors.join(" / ")}` });
        continue;
      }
      cards++;
      emit({ type: "card", release_id: p.note.id, card_id: out.card!.card_id, employee_id: owner, by, theme: it.themes[0] });
    } else {
      const list = unassignedCards();
      const t = nowJst();
      const card: UnassignedCard = {
        card_id: nextTeamCardId(list),
        employee_id: null,
        release_note_ids: [p.note.id],
        summary: it.summary.trim(),
        themes: it.themes.map((x) => x.trim()),
        format: it.format,
        format_reason: it.format_reason.trim(),
        related_employee_ids: p.candidates.map((c) => c.employee_id),
        created_at: t,
        updated_at: t,
      };
      saveUnassignedCards([...list, card]);
      unassigned++;
      emit({
        type: "unassigned",
        release_id: p.note.id,
        card_id: card.card_id,
        theme: card.themes[0],
        reason: p.candidates.length ? it.owner.reason || "候補の活動が同じ機能の仕事だと言い切れなかった" : "同じ機能に触れている活動が見つからなかった",
      });
    }
  }
  return { cards, unassigned };
}

/** リリースノートをカードにする（API を使う）。カードになっていないものだけを読む */
export async function updateReleaseCards(emit: (e: ReleaseEvent) => void): Promise<{ run_usd: number }> {
  const pending = pendingReleaseNotes();
  const runId = randomUUID();
  const { loop: model } = chooseModels();
  emit({ type: "start", run_id: runId, model, pending: pending.length });
  if (!pending.length) {
    emit({ type: "done", run_usd: 0, total_usd: totalUsd(), cards: 0, unassigned: 0 });
    return { run_usd: 0 };
  }
  const client = getClient();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `次のリリースノート（${pending.length}件）をカードにしてください。\n\n${pending.map(noteText).join("\n\n")}` },
  ];
  let saved = { cards: 0, unassigned: 0 };
  for (let call = 1; call <= MAX_CALLS; call++) {
    const res = await client.messages.create({
      model,
      max_tokens: 8000,
      system: instructions(),
      tools: [SUBMIT_DEF],
      // このモデルはツールの強制（tool_choice: tool / any）に対応していないので、指示文で submit_release_cards を呼ばせる
      messages,
    });
    recordUsage(runId, "release_cards", res.model, res.usage);
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === SUBMIT);
    if (!use) {
      emit({ type: "error", message: "提出がありませんでした" });
      break;
    }
    const items = ((use.input as { items?: SubmitItem[] }).items ?? []) as SubmitItem[];
    const errs = validateReleaseSubmit(items, pending);
    if (!errs.length) {
      saved = saveReleaseItems(items, pending, emit);
      break;
    }
    emit({ type: "rejected", errors: errs });
    if (call === MAX_CALLS) {
      emit({ type: "error", message: `${MAX_CALLS}回直しても通らなかったので保存しませんでした` });
      break;
    }
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: use.id, is_error: true, content: errs.join("\n") }] });
  }
  const run_usd = runUsd(runId);
  emit({ type: "done", run_usd, total_usd: totalUsd(), ...saved });
  return { run_usd };
}

// ---- 担当者未定のネタ：一覧と割り当て（技術広報が行う） ------------------------------------

export function listUnassigned() {
  const notes = new Map(releaseNotes().map((n) => [n.id, n]));
  const acts = activities();
  const actById = new Map(acts.map((x) => [x.id, x]));
  return unassignedCards().map((c) => {
    // 関わっていそうな人：キーワードが一致した活動（根拠）がある人だけ。根拠の活動を横に出す（コードで決める）
    const byPerson = new Map<string, { id: string; name: string; keywords: Set<string>; evidence: Map<string, { id: string; type: string; date: string; title: string }> }>();
    for (const rid of c.release_note_ids) {
      const n = notes.get(rid);
      if (!n) continue;
      for (const cand of ownerCandidates(n, acts)) {
        const p = byPerson.get(cand.employee_id) ?? { id: cand.employee_id, name: employeeById(cand.employee_id)?.name ?? cand.employee_id, keywords: new Set<string>(), evidence: new Map() };
        cand.matched_keywords.forEach((k) => p.keywords.add(k));
        for (const aid of cand.activity_ids) {
          const x = actById.get(aid);
          if (x) p.evidence.set(aid, { id: aid, type: x.type, date: x.date, title: x.title });
        }
        byPerson.set(cand.employee_id, p);
      }
    }
    return {
      ...c,
      release_notes: c.release_note_ids.map((id) => {
        const n = notes.get(id);
        return n ? { id, date: n.date, product: n.product, title: n.title, url: n.url, team: n.team } : { id, date: "", product: "", title: id, url: "", team: null };
      }),
      related_employees: [...byPerson.values()]
        .filter((p) => p.evidence.size > 0)
        .map((p) => ({ id: p.id, name: p.name, matched_keywords: [...p.keywords].slice(0, 5), evidence: [...p.evidence.values()] })),
    };
  });
}

/**
 * 技術広報が担当者を割り当てる。その人の普通のカードになり、確認済み（reviewed）として扱う。担当者未定のネタからは外す。
 * 割り当てた人は data/release_owners.json に by="human" で残り、リリースノートの活動の担当者になる。
 */
export function assignUnassigned(cardId: string, employeeId: string): { ok: boolean; errors: string[]; card_id?: string } {
  const list = unassignedCards();
  const u = list.find((c) => c.card_id === cardId);
  if (!u) return { ok: false, errors: [`担当者未定のネタ ${cardId} はありません`] };
  if (!employees().some((e) => e.id === employeeId)) return { ok: false, errors: [`社員 ${employeeId} はいません`] };
  const records = ownerRecords();
  const before = JSON.stringify(records);
  const t = nowJst();
  for (const id of u.release_note_ids)
    records[id] = { employee_id: employeeId, by: "human", matched_activity_ids: [], reason: "技術広報が割り当てた", at: t };
  saveOwnerRecords(records);
  const out = upsertCard({
    card_id: null,
    employee_id: employeeId,
    summary: u.summary,
    themes: u.themes,
    evidence_activity_ids: u.release_note_ids,
    format: u.format,
    format_reason: u.format_reason,
    published_ids: [],
    announcement_activity_ids: [],
  });
  if (!out.ok) {
    saveOwnerRecords(JSON.parse(before)); // 元に戻す
    return { ok: false, errors: out.errors };
  }
  const reviewed = editCard(out.card!.card_id, {}); // 人が担当者を決めたカードは確認済み（Agent は文を上書きしない）
  if (!reviewed.ok) return { ok: false, errors: reviewed.errors };
  saveUnassignedCards(list.filter((c) => c.card_id !== cardId));
  return { ok: true, errors: [], card_id: out.card!.card_id };
}
