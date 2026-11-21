// "ネタ帳を更新": one call per employee. The agent reads that person's activities and
// published items and creates / updates cards with upsert_card. The system prompt
// (instructions + roster + published list) is identical across employees, so it is cached.
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { getClient } from "./anthropic";
import { loadCards, upsertCard, type CardInput } from "./cards";
import { TODAY, TRENDS } from "./config";
import { activities, employees, published } from "./data";
import { UPSERT_CARD_DEF } from "./tools";
import { dataFile } from "./dataSource";
import { PLAIN_TEXT_RULE } from "./plainText";
import { chooseModels, recordUsage, runUsd, totalUsd } from "./usage";

// Follows DATA_SOURCE (lib/dataSource.ts). Resolved on each use so .env loaded after import still applies.
const STATE_FILE = () => dataFile("notebook_state.json");
const MAX_CALLS_PER_EMPLOYEE = 3;

/** employee_id -> latest activity date already read into the notebook. */
type NotebookState = Record<string, string>;

function loadState(): NotebookState {
  if (!fs.existsSync(STATE_FILE())) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE(), "utf-8")) as NotebookState;
}
function saveState(s: NotebookState) {
  fs.writeFileSync(STATE_FILE(), JSON.stringify(s, null, 2) + "\n", "utf-8");
}

export type NotebookEvent =
  | { type: "start"; run_id: string; model: string; targets: string[] }
  | { type: "employee"; employee_id: string; name: string; activity_count: number; n: number; of: number }
  | {
      type: "card";
      action: "created" | "updated" | "kept_reviewed";
      card_id: string;
      employee_id: string;
      theme: string;
      status: string;
      /** Human-readable line for the work log. */
      message: string;
    }
  | { type: "rejected"; employee_id: string; errors: string[] }
  | { type: "no_card"; employee_id: string; note: string }
  | { type: "usage"; run_usd: number; total_usd: number }
  | { type: "error"; message: string }
  | { type: "done"; run_usd: number; total_usd: number; created: number; updated: number; kept: number };

const INSTRUCTIONS = `あなたはLayerXの技術広報を支えるAgentです。社内の取り組みを読んで「ネタ帳」のカードを作り、育てます。カードは「誰が・何をして・どんなテーマなら社外で話せる／書けるか」を1枚にまとめたものです。技術広報はこのネタ帳を見て、登壇やブログの声かけをします。

今日は${TODAY}です。今の時流：${TRENDS.join("／")}

# 1回の仕事
社員1人分の活動（Slack投稿・PR・設計ドキュメント・週報）と、その人の発信済みの記録、既存のカードが渡されます。社外に出す価値のある取り組みごとにカードを作るか更新して、upsert_card を呼んでください。

# カードにする基準
- 社外の人が聞いて学びがある取り組み：課題・工夫・結果（数字があればなお良い）が読み取れるもの
- 日常の作業はカードにしない：依存ライブラリの更新、typo修正、文言変更、CIの一時的な失敗、ランチ会、面接調整、「特になし」の週報など
- 同じ取り組みが複数の投稿に分かれていたら、1枚にまとめて根拠に全部入れる
- 取り組みが別々なら別のカードにする（1人に複数枚あってよい）
- カードにするものがなければ、upsert_card を呼ばずに「カードなし：理由」と1行で答える

# 発信済みの取り組み
- 「公開しました」「登壇しました」「資料を公開しました」のような告知の投稿は、取り組みの根拠ではなく発信の記録です。evidence_activity_ids ではなく announcement_activity_ids に入れ、対応する published_ids を必ず付ける
- 告知の投稿がある発信済みの取り組みもカードにする。中身は published の記録（タイトル・タグ・読んでほしい人）と、本人の他の投稿から書く。告知しか材料がなければ evidence_activity_ids は空配列でよい
- 告知の投稿だけで、既存のカードと同じ取り組みの別カードを作らない。同じ取り組みのカードがあれば、そのカードに告知と published_ids を足す
- 告知の投稿がない古い発信（published だけにあるもの）は、カードにしなくてよい

# 各項目
- summary：何をして、どんな成果が出たか。2〜3文。数字は投稿にあるものだけ
- themes：1〜3個。本人の取り組みから絞った具体的なタイトル。「〇〇について」のような広いテーマにしない。時流とつながるなら、その切り口も使ってよい
- evidence_activity_ids：その取り組みの根拠になった、この人の activity id だけ。渡されていないidは書かない
- format：talk（20分以上の登壇）／lt（5〜10分）／blog。中身の厚さ、数字の有無、本人の登壇経験から選び、format_reason に1文で理由を書く
- published_ids：この取り組みをすでに発信した published の id（渡された発信済みの記録のうち、内容が一致するもの）。一致しなければ空配列

# 既存のカード
- 同じ取り組みのカードがあれば card_id を指定して更新する。新しく作り直さない
- 新しい活動が別の取り組みなら、新しいカードを作る
- reviewed=true のカードは技術広報が確認・修正したものです。要約・テーマ案・おすすめの形は変わりません。新しい根拠や発信があるとき、または新しい活動から別のテーマ案が考えられるときだけ card_id を指定して呼ぶ。テーマ案は「新しいテーマ案（未確認）」として技術広報に提案されます

upsert_card がエラーを返したら、内容を直してもう一度呼んでください。
summary・themes・format_reason は技術広報が読む文です。${PLAIN_TEXT_RULE}。`;

function buildSystem(): string {
  const roster = employees()
    .map((e) => `- ${e.id} ${e.name}｜${e.business_unit}｜${e.role}｜得意: ${e.expertise_tags.join("、")}｜登壇${e.past_talk_count}回`)
    .join("\n");
  return `${INSTRUCTIONS}\n\n# 社員一覧\n${roster}`;
}

let SYSTEM: string | undefined;

function employeeMessage(employeeId: string): { text: string; count: number; latest: string } {
  const e = employees().find((x) => x.id === employeeId)!;
  const acts = activities().filter((a) => a.author_id === employeeId);
  const pubs = published().filter((p) => p.author_id === employeeId);
  const cards = loadCards().filter((c) => c.employee_id === employeeId);
  const latest = acts.reduce((m, a) => (a.date > m ? a.date : m), "");
  const text = `# 社員
${e.id} ${e.name}｜${e.business_unit}｜${e.role}｜得意: ${e.expertise_tags.join("、")}｜登壇${e.past_talk_count}回｜最終登壇 ${e.last_talk_date ?? "なし"}

# 活動（${acts.length}件）
${acts.map((a) => `- ${a.id}｜${a.date}｜${a.type}｜${a.channel ?? a.repo}｜${a.title}\n  ${a.body}`).join("\n") || "（なし）"}

# 発信済みの記録（${pubs.length}件）
${pubs.map((p) => `- ${p.id}｜${p.published_at.slice(0, 10)}｜${p.genre}｜${p.title}｜タグ: ${p.tags.join("、")}`).join("\n") || "（なし）"}

# 既存のカード（${cards.length}枚）
${cards.map((c) => `- ${c.card_id}｜reviewed=${c.reviewed}｜${c.themes.join(" / ")}｜根拠 ${c.evidence_activity_ids.join(", ") || "なし"}｜告知 ${c.announcement_activity_ids.join(", ") || "なし"}｜published ${c.published_ids.join(", ") || "なし"}｜${c.summary}`).join("\n") || "（なし）"}`;
  return { text, count: acts.length, latest };
}

/** Employees whose activities changed since the last notebook update. */
export function pendingEmployees(): string[] {
  const state = loadState();
  return employees()
    .map((e) => e.id)
    .filter((id) => {
      const latest = activities()
        .filter((a) => a.author_id === id)
        .reduce((m, a) => (a.date > m ? a.date : m), "");
      return latest && state[id] !== latest;
    });
}

export async function updateNotebook(
  targets: string[] | "pending",
  emit: (e: NotebookEvent) => void,
): Promise<{ run_id: string; run_usd: number }> {
  const client = getClient();
  const runId = randomUUID();
  const { loop: model } = chooseModels();
  const ids = targets === "pending" ? pendingEmployees() : targets;
  emit({ type: "start", run_id: runId, model, targets: ids });
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: (SYSTEM ??= buildSystem()), cache_control: { type: "ephemeral" } }];
  const state = loadState();
  let created = 0;
  let updated = 0;
  let kept = 0;

  for (const [n, employeeId] of ids.entries()) {
    const emp = employees().find((x) => x.id === employeeId);
    if (!emp) {
      emit({ type: "error", message: `社員 ${employeeId} は存在しません` });
      continue;
    }
    const msg = employeeMessage(employeeId);
    emit({ type: "employee", employee_id: employeeId, name: emp.name, activity_count: msg.count, n: n + 1, of: ids.length });
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: msg.text }];
    let wroteAny = false;

    for (let call = 1; call <= MAX_CALLS_PER_EMPLOYEE; call++) {
      const res = await client.messages.create({
        model,
        max_tokens: 16000,
        system,
        tools: [UPSERT_CARD_DEF],
        messages,
        // Only the shared system prompt is cached. The per-employee message is used once,
        // so caching it would cost the 1.25x write rate for nothing.
        output_config: { effort: "medium" },
      });
      recordUsage(runId, "notebook", res.model, res.usage);
      emit({ type: "usage", run_usd: runUsd(runId), total_usd: totalUsd() });
      if (res.stop_reason === "refusal") {
        emit({ type: "error", message: `${emp.name}：モデルが処理を断りました` });
        break;
      }
      const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (uses.length === 0) {
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        if (!wroteAny) emit({ type: "no_card", employee_id: employeeId, note: text.slice(0, 200) || "カードなし" });
        break;
      }
      if (res.stop_reason === "max_tokens") {
        emit({ type: "error", message: `${emp.name}：出力が途中で切れました` });
        break;
      }
      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      let anyError = false;
      for (const u of uses) {
        if (u.name !== "upsert_card") {
          results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "このツールは使えません" });
          anyError = true;
          continue;
        }
        const input = { ...(u.input as CardInput), employee_id: employeeId }; // never write to someone else's cards
        const out = upsertCard(input);
        if (!out.ok) {
          anyError = true;
          emit({ type: "rejected", employee_id: employeeId, errors: out.errors });
          results.push({ type: "tool_result", tool_use_id: u.id, is_error: true, content: out.errors.join("\n") });
          continue;
        }
        wroteAny = true;
        if (out.action === "created") created++;
        else if (out.action === "updated") updated++;
        else kept++;
        const c = out.card!;
        const status = c.publication_status === "unpublished" ? "未発信" : c.publication_status === "blogged" ? "ブログ済み" : "登壇済み";
        let message: string;
        if (out.action === "created") message = `新しく作ったカード ${c.card_id}（${status}）：${c.themes[0]}`;
        else if (out.action === "updated") message = `更新したカード ${c.card_id}（${status}）：${c.themes[0]}`;
        else {
          const parts = ["確認済みカード：内容は変えず"];
          if (out.evidence_added?.length) parts.push(`根拠を${out.evidence_added.length}件追加（${out.evidence_added.join(", ")}）`);
          if (out.pending_themes_added?.length) parts.push(`新しいテーマ案を提案「${out.pending_themes_added.join("」「")}」`);
          if (parts.length === 1) parts.push("事実の項目だけ更新");
          message = `${parts.join("、")} ${c.card_id}`;
        }
        emit({ type: "card", action: out.action!, card_id: c.card_id, employee_id: employeeId, theme: c.themes[0], status, message });
        results.push({ type: "tool_result", tool_use_id: u.id, content: `${out.action}: ${out.card!.card_id}` });
      }
      // Only continue the conversation if something needs fixing; otherwise this employee is done.
      if (!anyError) break;
      messages.push({ role: "user", content: results });
    }
    if (msg.latest) {
      state[employeeId] = msg.latest;
      saveState(state);
    }
  }

  const run_usd = runUsd(runId);
  emit({ type: "done", run_usd, total_usd: totalUsd(), created, updated, kept });
  return { run_id: runId, run_usd };
}
