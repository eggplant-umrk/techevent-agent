// Mock mode for checking the screens without an API key and without touching data/.
// - Reads (cards, requests, state) still come from data/ through the GET routes.
// - The agent run replays a real proposal saved by the evaluation (docs/eval_after.json → proposals.json).
// - Pasted request text always comes back as "no fit", to show that screen.
// - Edits, adopt/drop, and outcomes are kept in memory only.
import type { Api, DraftResponse } from "./api";
import proposals from "./proposals.json";
import type {
  AgentEvent,
  BlogIdea,
  Candidate,
  Card,
  NotebookCard,
  NotebookEvent,
  OutreachDraft,
  Proposal,
  SpeakingRequest,
} from "./types";

type Fixture = { result: Proposal; run_usd: number };
/** Saved eval results can predate newer candidate fields; fill the defaults so the screens get the current shape. */
const FIXTURES: Record<string, Fixture> = Object.fromEntries(
  Object.entries(proposals as unknown as Record<string, Fixture>).map(([k, f]) => [
    k,
    {
      ...f,
      result: {
        ...f.result,
        candidates: f.result.candidates.map((c) => ({
          ...c,
          confidence: c.confidence ?? "strong",
          caveat: c.caveat ?? null,
          is_nominee: c.is_nominee ?? false,
          evidence_request_id: c.evidence_request_id ?? null,
        })),
      },
    },
  ]),
);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = "2026-11-21";

type Overlay = Partial<Card>;

/** Starting state so every screen has something to show. */
function initialOverlay(): Map<string, Overlay> {
  return new Map<string, Overlay>([
    [
      "card-e013-01",
      {
        reviewed: true,
        reviewed_at: "2026-11-20T09:12:00Z",
        edited_fields: ["themes", "format_reason"],
        pending_themes: ["プロンプト変更のたびに回す評価ケースを、失敗ログからどう増やしたか"],
      },
    ],
    [
      "card-e015-01",
      {
        outreach_history: [
          { date: today, request_id: "req003", result: "approved", reason: null, event_date: "2027-02-10" },
          { date: today, request_id: "req003", result: "declined", reason: "busy", event_date: "2027-02-10" },
        ],
      },
    ],
  ]);
}

const NO_FIT: Omit<Proposal, "run_id" | "request_id"> = {
  request_pattern: "theme_specified",
  summary:
    "Rustを使った組み込み開発の事例を求める依頼です。ネタ帳と投稿を検索しましたが、組み込み・Rustの取り組みを持つ人は見つかりませんでした。",
  nominee_assessment: null,
  learnings_applied: [],
  no_fit: {
    reasons: [
      "ネタ帳18枚のうち、Rust・組み込みに触れたカードはありませんでした。",
      "投稿（Slack・PR・週報・設計）も「Rust」「組み込み」で探しましたが、該当は0件でした。",
      "近いものに性能改善のカード（百瀬さん）がありますが、Webフロントエンドの話で依頼の趣旨とずれます。",
    ],
    next_checks: [
      "依頼元に、テーマを「性能改善」まで広げてよいか確認する。",
      "Rustを業務の外で使っている人がいないか、技術系のチャンネルで聞いてみる。",
      "ネタ帳にない新しい取り組みがあれば、「ネタ帳を更新」で読み込んでから探し直す。",
    ],
  },
  candidates: [],
};

function draftFor(c: Candidate, req: SpeakingRequest | undefined): OutreachDraft {
  const ev = req?.event;
  const title = ev?.title ?? "ご相談中のイベント";
  const mins = ev?.duration_min ?? 10;
  return {
    subject: `【ご相談】${title}での${ev?.format ?? "LT"}登壇について`,
    message: `${c.name.split(" ")[0]}さん

技術広報の〇〇です。突然すみません。
${ev ? `${ev.date}に開催される「${title}」（${ev.audience}）` : `「${title}」`}で、LayerXから${mins}分の枠をいただいています。

${c.name.split(" ")[0]}さんの取り組みを拝見して、
「${c.theme}」
というテーマでお話しいただけないかと考えています。${c.reason}

準備の負担はできるだけこちらで持ちます（構成案のたたき台・スライドのレビューなど）。
ご都合や気になる点があれば、気軽に返してください。断っていただいても大丈夫です。`,
    lt_outline: [
      { minutes: 1, heading: "自己紹介と背景", points: ["チームと担当している領域", "なぜこの課題に取り組んだか"] },
      { minutes: Math.max(2, Math.round(mins * 0.4)), heading: "やったこと", points: ["最初に試したことと、うまくいかなかった点", "最終的な仕組み"] },
      { minutes: Math.max(2, Math.round(mins * 0.3)), heading: "結果と数字", points: ["ビフォーアフター", "運用して分かったこと"] },
      { minutes: 1, heading: "まとめ", points: ["持ち帰ってほしい1つのこと"] },
    ],
    tips_for_pr: [
      `忙しさは${c.workload}です。準備にかかる時間の目安を最初に伝えると返事がもらいやすくなります。`,
      ...c.cautions.map((x) => `注意点：${x}`),
    ],
  };
}

export function mockApi(real: Api): Api {
  const overlay = initialOverlay();
  let total = 2.24;
  let requests: SpeakingRequest[] = [];
  let lastCards: NotebookCard[] = [];

  const apply = (c: NotebookCard): NotebookCard => {
    const o = overlay.get(c.card_id);
    return o ? { ...c, ...o } : c;
  };
  const patch = (cardId: string, fn: (c: NotebookCard) => Overlay) => {
    const base = lastCards.find((c) => c.card_id === cardId);
    if (!base) throw new Error(`カード ${cardId} が見つかりません`);
    overlay.set(cardId, { ...overlay.get(cardId), ...fn(base), updated_at: new Date().toISOString() });
  };

  return {
    mock: true,
    async cards() {
      const r = await real.cards();
      lastCards = r.cards.map(apply).sort((a, b) => Number(b.reviewed) - Number(a.reviewed));
      return { ...r, cards: lastCards };
    },
    async state() {
      const s = await real.state();
      return { ...s, models: { ...s.models, totalUsd: total } };
    },
    async requests() {
      requests = await real.requests();
      return requests;
    },
    async runAgent(body, onEvent) {
      const fixture = FIXTURES[body.request_id];
      const result: Proposal = body.custom_text || !fixture
        ? { ...NO_FIT, run_id: `mock-${Date.now()}`, request_id: body.request_id }
        : { ...fixture.result, run_id: `mock-${Date.now()}` };
      const runUsd = fixture && !body.custom_text ? fixture.run_usd : 0.061;
      const emit = async (e: AgentEvent, ms = 450) => {
        await wait(ms);
        onEvent(e);
      };
      await emit({ type: "start", run_id: result.run_id, loop_model: "claude-opus-5-5", heavy_model: "claude-fable-5-2", switched: false, total_usd: total, switch_usd: 150 }, 100);
      await emit({ type: "step", n: 1, max: 15 });
      await emit({ type: "thinking", text: "まずネタ帳から、依頼のテーマに近いカードと未発信のカードを探します。" });
      await emit({ type: "tool_call", id: "t1", name: "search_cards", input: { query: result.candidates[0]?.theme.slice(0, 16) ?? "Rust 組み込み" } });
      await emit({ type: "tool_result", id: "t1", name: "search_cards", ok: true, summary: result.candidates.length ? `${result.candidates.length + 4}枚が見つかりました` : "0枚" });
      if (!result.candidates.length) {
        await emit({ type: "tool_call", id: "t1b", name: "search_activities", input: { query: "Rust 組み込み" } });
        await emit({ type: "tool_result", id: "t1b", name: "search_activities", ok: true, summary: "0件" });
      }
      await emit({ type: "step", n: 2, max: 15 });
      for (const c of result.candidates) {
        if (c.card_id) {
          await emit({ type: "tool_call", id: `g-${c.employee_id}`, name: "get_card", input: { card_id: c.card_id } });
          await emit({ type: "tool_result", id: `g-${c.employee_id}`, name: "get_card", ok: true, summary: `${c.name}：打診履歴 ${c.card?.outreach_history.length ?? 0}件` }, 250);
        }
        const date = requests.find((r) => r.id === body.request_id)?.event?.date ?? "";
        await emit({ type: "tool_call", id: `s-${c.employee_id}`, name: "check_schedule", input: { id: c.employee_id, date } }, 250);
        await emit({ type: "tool_result", id: `s-${c.employee_id}`, name: "check_schedule", ok: true, summary: "前後3日に予定なし" }, 250);
      }
      await emit({ type: "step", n: 3, max: 15 });
      await emit({ type: "tool_call", id: "t9", name: "submit_candidates", input: {} });
      await emit({ type: "tool_result", id: "t9", name: "submit_candidates", ok: true, summary: result.candidates.length ? `候補${result.candidates.length}人を提出` : "合う候補なしで提出" });
      total += runUsd;
      await emit({ type: "usage", run_usd: runUsd, total_usd: total, cache_read: 0, input: 0, output: 0 }, 50);
      if (result.alternative_pitch) await emit({ type: "alternative_pitch", text: result.alternative_pitch, model: "claude-fable-5-2", fell_back: false });
      await emit({ type: "final", result });
      await emit({ type: "done", run_usd: runUsd, total_usd: total, steps: 3 }, 50);
    },
    async updateNotebook(onEvent) {
      const emit = async (e: NotebookEvent) => {
        await wait(500);
        onEvent(e);
      };
      await emit({ type: "start", run_id: "mock-nb", model: "claude-opus-5-5", targets: ["e013", "e026"] });
      await emit({ type: "employee", employee_id: "e013", name: "早乙女 蓮", activity_count: 2, n: 1, of: 2 });
      await emit({ type: "card", action: "kept_reviewed", card_id: "card-e013-01", employee_id: "e013", theme: "", status: "unpublished", message: "確認済みカード：内容は変えず、根拠だけ追加（早乙女 蓮）" });
      await emit({ type: "employee", employee_id: "e026", name: "鷹野", activity_count: 1, n: 2, of: 2 });
      await emit({ type: "card", action: "updated", card_id: "card-e026-01", employee_id: "e026", theme: "", status: "unpublished", message: "カードを更新：最新の活動日と根拠を追加（鷹野）" });
      total += 0.03;
      await emit({ type: "usage", run_usd: 0.03, total_usd: total });
      await emit({ type: "done", run_usd: 0.03, total_usd: total, created: 0, updated: 1, kept: 1 });
    },
    async blogIdeas() {
      await wait(700);
      const ideas: BlogIdea[] = lastCards
        .filter((c) => c.publication_status === "unpublished")
        .slice(0, 3)
        .map((c) => ({
          card_id: c.card_id,
          title: c.themes[0],
          why_easy_to_blog: c.format_reason,
          outline: ["背景と課題", "やったこと", "結果と数字", "次にやること"],
        }));
      total += 0.02;
      return { ideas, run_usd: 0.02, total_usd: total };
    },
    async draft(body): Promise<DraftResponse> {
      await wait(900);
      const fixtures = Object.values(FIXTURES);
      const cand =
        fixtures.flatMap((f) => f.result.candidates).find((c) => c.employee_id === body.candidate.employee_id) ??
        ({ name: "候補", workload: 3, cautions: [], ...body.candidate } as unknown as Candidate);
      const req = requests.find((r) => r.id === body.request_id);
      total += 0.04;
      return { draft: draftFor({ ...cand, theme: body.candidate.theme, reason: body.candidate.reason }, req), model: "claude-fable-5-2", fell_back: false, run_usd: 0.04, total_usd: total };
    },
    async outcome(body) {
      await wait(200);
      const cardId = body.card_id;
      if (!cardId) throw new Error("モックではカードのない候補を記録できません");
      const req = requests.find((r) => r.id === body.request_id);
      patch(cardId, (c) => ({
        outreach_history: [
          ...c.outreach_history,
          { date: today, request_id: body.request_id, result: body.result, reason: body.result === "declined" ? body.reason ?? "other" : null, event_date: req?.event?.date ?? null },
        ],
      }));
      return apply(lastCards.find((c) => c.card_id === cardId)!);
    },
    async editCard(cardId, p) {
      await wait(200);
      patch(cardId, (c) => ({
        ...p,
        reviewed: true,
        reviewed_at: new Date().toISOString(),
        edited_fields: [...new Set([...c.edited_fields, ...Object.keys(p).filter((k) => JSON.stringify(p[k as keyof typeof p]) !== JSON.stringify(c[k as keyof Card]))])],
      }));
    },
    async resolvePending(cardId, theme, accept) {
      await wait(200);
      patch(cardId, (c) => ({
        pending_themes: c.pending_themes.filter((t) => t !== theme),
        themes: accept ? [...c.themes, theme].slice(-3) : c.themes,
      }));
    },
  };
}
