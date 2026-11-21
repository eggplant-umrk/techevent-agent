// Mock mode for checking the screens without an API key and without touching data/.
// - Reads (cards, requests, state) still come from data/ through the GET routes.
// - The agent run replays a real proposal saved by the evaluation (docs/eval_after.json → proposals.json).
// - Pasted request text always comes back as "no fit", to show that screen.
// - 受信箱：保存済みの結果がある5件が「準備済み」で並ぶ。手で追加した依頼は手元だけで準備中→準備済み（合う候補なし）。
// - Edits, adopt/drop, and outcomes are kept in memory only.
// - 人の情報を直すのも手元だけ（data/people.json には書かない）。アーカイブは読むだけなので GET をそのまま使う。
import type { Api, DraftResponse } from "./api";
import { fallbackOrganizerReply } from "@/lib/organizerReply";
import { recordsFor, requestState } from "@/lib/requestStage";
import { eventUrlsIn } from "@/lib/eventUrls";

/** lib/intake.ts の INTAKE_LABEL と同じ（lib/intake.ts は API の呼び出しを含むので画面からは読まない） */
const INTAKE_LABEL_MOCK = { event_name: "イベント名", date: "日程", format: "形式", theme: "テーマ", organizer: "主催者の名前" } as const;
import proposals from "./proposals.json";
import postevent from "./postevent.json";
import venueFixtures from "./venues.json";
import xconvFixture from "./xconv.json";
import type {
  AgentEvent,
  EventDetail,
  Reaction,
  SurveyEvent,
  BlogIdea,
  Candidate,
  BoardDetail,
  BoardListItem,
  Card,
  InboxDetail,
  NotebookCard,
  NotebookEvent,
  OutreachDraft,
  Person,
  PersonPatch,
  Proposal,
  SpeakingRequest,
  VenueEvent,
  VenueResult,
} from "./types";

type Fixture = { result: Proposal; run_usd: number };

/** アンケート分析の保存済みの結果（scripts/update_postevent_mock.ts が本番の分析結果から作る）。
 *  登壇者ごとの項目は入れない：overview はイベント単位の集計、voices は次に聞きたいテーマと話せそうな人のカードだけ。
 *  cards：その分析でカードに書き戻した反応と、テーマ案（未確認）に足したもの */
type Overview = NonNullable<EventDetail["overview"]["analysis"]>;
type PostEventFixture = {
  overview: Overview;
  voices: Array<{ text: string; count: number; match_card_id: string | null }>;
  model: string;
  run_usd: number;
  sentences: number;
  writebacks: string[];
  cards: Record<string, { reactions: Reaction[]; pending_themes_added: string[] }>;
};
const POSTEVENT = postevent as unknown as Record<string, PostEventFixture>;
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

/** カード → 出し先の保存済みの結果（scripts/update_mock.ts が docs/eval_latest.json から作る）。card_id ごと */
type VenueFixture = { result: VenueResult; events: VenueEvent[]; run_usd: number };
const VENUE_FIXTURES = venueFixtures as unknown as Record<string, VenueFixture>;

/**
 * X の会話を貼った依頼の保存済みの結果（scripts/try_xconv.ts が本物の API で1回作ったもの）。
 * 会話から読み取った項目（未定つき）・候補・主催者への返事を ?mock で見せる
 */
type XFixture = { run_usd: number; detail: InboxDetail; draft: OutreachDraft | null };
const X_FIXTURE = xconvFixture as unknown as XFixture;
const X_ID = X_FIXTURE.detail.id;
const xResult = (): Proposal | null => (X_FIXTURE.detail.result ? { ...X_FIXTURE.detail.result, request_id: X_ID, run_id: `mock-${X_ID}` } : null);
const xRequest = (): SpeakingRequest => ({ id: X_ID, message: X_FIXTURE.detail.text, intake: X_FIXTURE.detail.intake ?? undefined });

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
      `${c.busy_text ?? "予定は不明"}。準備にかかる時間の目安を最初に伝えると返事がもらいやすくなります。`,
      ...c.cautions.map((x) => `注意点：${x}`),
    ],
    // 主催者への返事：モックでは本物の検査に通る決まった形の文（lib/organizerReply.ts）を使う
    organizer_reply: fallbackOrganizerReply({
      name: c.name,
      theme: c.theme,
      organizer: req?.requester?.contact_name ?? req?.intake?.organizer ?? null,
      eventName: ev?.title ?? req?.intake?.event_name ?? null,
      undecided: (req?.intake?.undecided ?? []).map((f) => INTAKE_LABEL_MOCK[f]),
    }),
    organizer_reply_note: null,
  };
}

type PersonOverlay = PersonPatch & { edited_fields: Person["edited_fields"] };

export function mockApi(real: Api): Api {
  const overlay = initialOverlay();
  // 人の情報（手元だけ）。最初から1人「確認済み」にしておく
  const personOverlay = new Map<string, PersonOverlay>([["e013", { speaking_intent: "available", edited_fields: ["speaking_intent"] }]]);
  const applyPerson = (p: Person): Person => {
    const o = personOverlay.get(p.id);
    if (!o) return p;
    return {
      ...p,
      expertise_tags: o.expertise_tags ?? p.expertise_tags,
      speaking_intent: o.speaking_intent ?? p.speaking_intent,
      ng_themes: o.ng_themes ?? p.ng_themes,
      reviewed: true,
      edited_fields: [...new Set([...p.edited_fields, ...o.edited_fields])],
    };
  };
  let total = 2.24;
  let requests: SpeakingRequest[] = [];
  let lastCards: NotebookCard[] = [];
  /** Cards created in memory when a candidate without a card is approved (same rule as /api/outcome). */
  const created: NotebookCard[] = [];
  /** モックで分析を再生したイベント */
  const analyzed = new Map<string, Overview>();

  // 受信箱（手元だけ）
  type MockItem = Omit<BoardListItem, "state" | "event_date">;
  const inboxItems: MockItem[] = [];
  /** 下書き（主催者への返事を承諾済みの依頼で出すため）。依頼id:社員id */
  const drafts = new Map<string, OutreachDraft>();
  /** 担当者を割り当てた担当者未定のネタ（手元だけ。一覧から外す） */
  const assigned = new Set<string>();
  /** 代わりの人を推す文ができる時刻（モックの「作成中」の再現） */
  const pitchReadyAt = new Map<string, number>();
  const inboxTexts = new Map<string, string>();
  // 一覧の読み込みと ?inbox= で開く処理が同時に来ても、並べるのは1回だけ（2回並ぶと同じ依頼が重複する）
  let inboxReady: Promise<void> | null = null;
  /** 状態の計算に使うカード（打診履歴を手元で書き足したものも入れる） */
  async function ensureCards() {
    if (!lastCards.length) lastCards = [...(await real.cards()).cards, ...created];
  }
  function eventDateOf(id: string): string | null {
    if (id === X_ID) return X_FIXTURE.detail.intake?.date ?? null;
    return requests.find((r) => r.id === id)?.event?.date ?? null;
  }
  function withState(x: MockItem): BoardListItem {
    const cards = lastCards.map(apply);
    const nameOf = (eid: string) => cards.find((c) => c.employee_id === eid)?.employee?.name ?? eid;
    const base = x.status === "processing" ? "processing" : x.status === "error" ? "error" : "ready";
    const date = eventDateOf(x.id);
    return { ...x, state: requestState(base, recordsFor(x.id, cards, nameOf), date, today), event_date: date };
  }
  function acceptedReply(id: string, state: BoardListItem["state"]): BoardDetail["accepted_reply"] {
    for (const p of state.accepted_by) {
      const d = drafts.get(`${id}:${p.employee_id}`);
      if (d?.organizer_reply) return { name: p.name, text: d.organizer_reply };
    }
    return null;
  }
  const ensureInbox = () => (inboxReady ??= fillInbox());
  async function fillInbox() {
    if (!requests.length) requests = await real.requests();
    // サンプルの依頼（保存済みの結果がある）を、受信箱に届いて準備済みになったものとして並べる（新しい順）
    const ids = Object.keys(FIXTURES).sort().reverse();
    for (const [i, id] of ids.entries()) {
      const r = requests.find((x) => x.id === id);
      const f = FIXTURES[id];
      inboxItems.push({
        id,
        source: "sample",
        status: "ready",
        received_at: `2026-11-21T0${9 - i}:30:00+09:00`,
        is_new: i < 2, // 上の2件は「新しい」
        title: r?.event?.title ?? id,
        candidate_names: f.result.candidates.map((c) => c.name),
        no_fit: f.result.candidates.length === 0,
        error: null,
        permalink: null,
      });
    }
    // X の会話を手で貼った依頼（いちばん新しい）
    const d = X_FIXTURE.detail;
    inboxItems.unshift({
      id: X_ID,
      source: "manual",
      status: "ready",
      received_at: d.received_at,
      is_new: true,
      title: d.title,
      candidate_names: d.candidate_names,
      no_fit: d.no_fit,
      error: null,
      permalink: null,
    });
  }

  /** 作業ログ（実行の再現にも、受信箱を開いたときの表示にも使う）。[イベント, 待ち時間ms] */
  function eventsFor(result: Proposal, requestId: string, runUsd: number): Array<[AgentEvent, number]> {
    const ev: Array<[AgentEvent, number]> = [];
    const push = (e: AgentEvent, ms = 450) => ev.push([e, ms]);
    push({ type: "start", run_id: result.run_id, loop_model: "claude-opus-5-5", heavy_model: "claude-fable-5-2", switched: false, total_usd: total, switch_usd: 150 }, 100);
    push({ type: "step", n: 1, max: 15 });
    push({ type: "thinking", text: "考えています" });
    push({ type: "tool_call", id: "t1", name: "search_cards", input: { query: result.candidates[0]?.theme.slice(0, 16) ?? "Rust 組み込み" } });
    push({ type: "tool_result", id: "t1", name: "search_cards", ok: true, summary: result.candidates.length ? `${result.candidates.length + 4}枚が見つかりました` : "0枚" });
    if (!result.candidates.length) {
      push({ type: "tool_call", id: "t1b", name: "search_activities", input: { query: "Rust 組み込み" } });
      push({ type: "tool_result", id: "t1b", name: "search_activities", ok: true, summary: "0件" });
    }
    push({ type: "step", n: 2, max: 15 });
    for (const c of result.candidates) {
      if (c.card_id) {
        push({ type: "tool_call", id: `g-${c.employee_id}`, name: "get_card", input: { card_id: c.card_id } });
        push({ type: "tool_result", id: `g-${c.employee_id}`, name: "get_card", ok: true, summary: `${c.name}：打診履歴 ${c.card?.outreach_history.length ?? 0}件` }, 250);
      }
      const date = requests.find((r) => r.id === requestId)?.event?.date ?? "";
      push({ type: "tool_call", id: `s-${c.employee_id}`, name: "check_schedule", input: { id: c.employee_id, date } }, 250);
      push({ type: "tool_result", id: `s-${c.employee_id}`, name: "check_schedule", ok: true, summary: "前後3日に予定なし" }, 250);
    }
    push({ type: "step", n: 3, max: 15 });
    push({ type: "tool_call", id: "t9", name: "submit_candidates", input: {} });
    push({ type: "tool_result", id: "t9", name: "submit_candidates", ok: true, summary: result.candidates.length ? `候補${result.candidates.length}人を提出` : "合う候補なしで提出" });
    push({ type: "usage", run_usd: runUsd, total_usd: total, cache_read: 0, input: 0, output: 0 }, 50);
    if (result.alternative_pitch) push({ type: "alternative_pitch", text: result.alternative_pitch, model: "claude-fable-5-2", fell_back: false });
    push({ type: "final", result });
    push({ type: "done", run_usd: runUsd, total_usd: total, steps: 3 }, 50);
    return ev;
  }

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
      lastCards = [...r.cards, ...created].map(apply).sort((a, b) => Number(b.reviewed) - Number(a.reviewed));
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
      const x = body.request_id === X_ID ? xResult() : null;
      if (x) {
        total += X_FIXTURE.run_usd;
        for (const [e, ms] of eventsFor(x, body.request_id, X_FIXTURE.run_usd)) {
          await wait(ms);
          onEvent(e);
        }
        return;
      }
      const inboxText = inboxItems.find((x) => x.id === body.request_id && !FIXTURES[x.id]);
      const result: Proposal = body.custom_text || inboxText || !fixture
        ? { ...NO_FIT, run_id: `mock-${Date.now()}`, request_id: body.request_id }
        : { ...fixture.result, run_id: `mock-${Date.now()}` };
      const runUsd = fixture && !body.custom_text ? fixture.run_usd : 0.061;
      total += runUsd;
      for (const [e, ms] of eventsFor(result, body.request_id, runUsd)) {
        await wait(ms);
        onEvent(e);
      }
    },
    // ---- 受信箱：サンプルの依頼（保存済みの結果）を「準備済み」として並べる。追加は手元だけで準備中→準備済み
    //      依頼の状態は、手元のカードの打診履歴からサーバーと同じ関数で決める
    async inbox() {
      await ensureInbox();
      await ensureCards();
      return inboxItems.map(withState);
    },
    async inboxAdd(text) {
      await wait(200);
      const id = `inb-mock-${inboxItems.length + 1}`;
      const now = new Date().toISOString();
      const title = text.split(/\r?\n/).find((l) => l.trim()) ?? text;
      inboxItems.unshift({ id, source: "manual", status: "processing", received_at: now, is_new: true, title: title.slice(0, 70), candidate_names: [], no_fit: false, error: null, permalink: null });
      inboxTexts.set(id, text);
      setTimeout(() => {
        const it = inboxItems.find((x) => x.id === id);
        if (it) Object.assign(it, { status: "ready", no_fit: true });
      }, 2500);
      return { id };
    },
    async inboxDetail(id) {
      await ensureInbox();
      await ensureCards();
      const it = inboxItems.find((x) => x.id === id);
      if (!it) throw new Error("その依頼は受信箱にありません");
      const st = withState(it);
      const textOf = id === X_ID ? X_FIXTURE.detail.text : inboxTexts.get(id) ?? requests.find((r) => r.id === id)?.message ?? it.title;
      const extra = { state: st.state, event_date: st.event_date, accepted_reply: acceptedReply(id, st.state), event_urls: eventUrlsIn(textOf) };
      if (id === X_ID) {
        const result = xResult();
        return { ...X_FIXTURE.detail, ...extra, is_new: it.is_new, result, events: result ? eventsFor(result, id, X_FIXTURE.run_usd).map(([e]) => e) : [] } as BoardDetail;
      }
      const fixture = FIXTURES[id];
      const result: Proposal | null =
        it.status !== "ready" ? null : fixture ? { ...fixture.result, run_id: `mock-${id}` } : { ...NO_FIT, run_id: `mock-${id}`, request_id: id };
      const runUsd = fixture?.run_usd ?? 0.061;
      // 代わりの人を推す文は、受信箱では候補のあとで作る（pitch_status）。モックでは最初に開いてから5秒だけ「作成中」にする
      const hasPitch = !!result?.alternative_pitch;
      if (hasPitch && !pitchReadyAt.has(id)) pitchReadyAt.set(id, Date.now() + 5000);
      const pending = hasPitch && Date.now() < (pitchReadyAt.get(id) ?? 0);
      const shown = result && pending ? { ...result, alternative_pitch: undefined } : result;
      return {
        ...it,
        text: inboxTexts.get(id) ?? requests.find((r) => r.id === id)?.message ?? it.title,
        nominee_name: fixture?.result.candidates.find((c) => c.is_nominee)?.name ?? null,
        intake: null,
        result: shown,
        events: shown ? eventsFor(shown, id, runUsd).map(([e]) => e).filter((e) => !(pending && e.type === "alternative_pitch")) : [],
        run_usd: result ? runUsd : 0,
        pitch_status: hasPitch ? (pending ? "pending" : "ready") : null,
        ...extra,
      };
    },
    async inboxOpen(id) {
      const it = inboxItems.find((x) => x.id === id);
      if (it) it.is_new = false;
    },
    // ---- カード → 出し先：保存済みの結果（venues.json）を再生する。ないカードは「見つからない」を見せる
    async venues(cardId, onEvent) {
      const fx = VENUE_FIXTURES[cardId];
      const card = lastCards.find((c) => c.card_id === cardId);
      const result: VenueResult = fx
        ? { ...fx.result, run_id: `mock-venue-${Date.now()}` }
        : {
            run_id: `mock-venue-${Date.now()}`,
            card_id: cardId,
            employee_id: card?.employee_id ?? "",
            employee_name: card?.employee?.name ?? "",
            summary: "（モック）このカードの保存済みの結果はありません。表示を確かめるための例です。",
            venues: [],
            no_fit: {
              reasons: ["手元の外部イベントのデータに、このネタのテーマに合う募集中のイベントがありませんでした。"],
              next_checks: ["来月の募集をもう一度探す。", "まずブログにして、反応を見てから登壇先を探す。"],
            },
            blog: null,
            blog_note: "（モック）ブログ案は保存済みの結果があるカードだけ表示します",
          };
      const events: VenueEvent[] = fx?.events?.length
        ? fx.events
        : [
            { type: "tool_call", id: "v1", name: "search_external_events", input: { query: card?.themes[0]?.slice(0, 12) ?? "" } },
            { type: "tool_result", id: "v1", name: "search_external_events", ok: true, summary: "8件（応募できるもの 5件）" },
          ];
      for (const e of events) {
        if (e.type === "venue_final" || e.type === "done" || e.type === "usage" || e.type === "start") continue;
        await wait(e.type === "tool_result" ? 300 : 150);
        onEvent(e);
      }
      total += fx?.run_usd ?? 0.05;
      onEvent({ type: "venue_final", result });
      onEvent({ type: "done", run_usd: fx?.run_usd ?? 0.05, total_usd: total, steps: 3 });
    },
    async venueDraft(body) {
      await wait(700);
      const card = lastCards.find((c) => c.card_id === body.card_id);
      const name = card?.employee?.name.split(" ")[0] ?? "";
      const fx = VENUE_FIXTURES[body.card_id];
      const v = fx?.result.venues.find((x) => x.event_id === body.event_id);
      const ev = v?.name ?? "社外イベント";
      total += 0.05;
      return {
        draft: {
          subject: `【ご相談】「${body.theme}」で${ev}に出てみませんか`,
          message: `${name}さん\n\n技術広報の〇〇です。${name}さんの取り組みを拝見して、このネタで「${ev}」に応募してみるのはどうかなと思い、ご連絡しました。\n\n${body.reason}\n\n応募の締切や募集の内容は、公式ページで最新の情報を確かめてください。応募文や資料づくりはこちらでも手伝えます。ご都合が合わなければ、見送っていただいて大丈夫です。`,
          lt_outline: [
            { minutes: 2, heading: "自己紹介と背景", points: ["チームと担当している領域", "なぜこの課題に取り組んだか"] },
            { minutes: 8, heading: "やったこと", points: ["最初に試したことと、うまくいかなかった点", "最終的な仕組み"] },
            { minutes: 8, heading: "結果と数字", points: ["ビフォーアフター", "運用して分かったこと"] },
            { minutes: 2, heading: "まとめ", points: ["持ち帰ってほしい1つのこと"] },
          ],
          tips_for_pr: ["応募の締切と募集の形式を、公式ページで先に確かめておく。", ...(body.cautions ?? []).map((c) => `注意点：${c}`)],
        },
        model: "claude-fable-5-2",
        fell_back: false,
        run_usd: 0.05,
        total_usd: total,
      };
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
      // Look the candidate up in THIS request's fixture only. Searching every fixture by employee
      // picked 笹倉さん's req003 entry for req004 and showed req003's dates in the draft.
      const own = body.request_id ? FIXTURES[body.request_id]?.result.candidates.find((c) => c.employee_id === body.candidate.employee_id) : undefined;
      const anyProfile = Object.values(FIXTURES)
        .flatMap((f) => f.result.candidates)
        .find((c) => c.employee_id === body.candidate.employee_id);
      const cand =
        own ??
        (anyProfile
          ? ({ ...anyProfile, cautions: [], caveat: null } as Candidate) // profile only; cautions belong to another request
          : ({ name: "候補", busy_text: "予定は不明", cautions: [], ...body.candidate } as unknown as Candidate));
      // X の会話の依頼：保存済みの下書き（本物の API で作った主催者への返事つき）。ほかの人を選んだら決まった形の文
      const keep = (d: OutreachDraft) => (body.request_id && drafts.set(`${body.request_id}:${body.candidate.employee_id}`, d), d);
      if (body.request_id === X_ID && X_FIXTURE.draft && X_FIXTURE.detail.result?.candidates[0]?.employee_id === body.candidate.employee_id) {
        total += 0.1;
        return { draft: keep(X_FIXTURE.draft), model: "claude-fable-5-2", fell_back: false, run_usd: 0.1, total_usd: total };
      }
      const xCand = body.request_id === X_ID ? X_FIXTURE.detail.result?.candidates.find((c) => c.employee_id === body.candidate.employee_id) : undefined;
      const req = body.request_id === X_ID ? xRequest() : requests.find((r) => r.id === body.request_id);
      total += 0.04;
      if (xCand) return { draft: keep(draftFor({ ...xCand, theme: body.candidate.theme, reason: body.candidate.reason }, req)), model: "claude-fable-5-2", fell_back: false, run_usd: 0.04, total_usd: total };
      return { draft: keep(draftFor({ ...cand, theme: body.candidate.theme, reason: body.candidate.reason }, req)), model: "claude-fable-5-2", fell_back: false, run_usd: 0.04, total_usd: total };
    },
    async outcome(body) {
      await wait(200);
      const req = requests.find((r) => r.id === body.request_id);
      let cardId = body.card_id;
      if (!cardId) {
        // Mirror /api/outcome: make a card from the proposal; a nominee's evidence is the request itself.
        const c = body.candidate;
        const isNominee = req?.nominated_employee_id === c.employee_id;
        if (!c.evidence_activity_ids.length && !isNominee) throw new Error("根拠のない候補はカードにできません");
        const existing = created.find((x) => x.employee_id === c.employee_id && x.themes[0] === c.theme);
        if (existing) cardId = existing.card_id;
        else {
          const cand = Object.values(FIXTURES)
            .flatMap((f) => f.result.candidates)
            .find((x) => x.employee_id === c.employee_id);
          const now = new Date().toISOString();
          const card: NotebookCard = {
            card_id: `card-${c.employee_id}-mock${created.length + 1}`,
            employee_id: c.employee_id,
            summary: c.reason,
            themes: [c.theme],
            evidence_activity_ids: c.evidence_activity_ids,
            format: "lt",
            format_reason: isNominee && !c.evidence_activity_ids.length ? "指名の依頼から作成したカード（根拠は依頼そのもの）" : "依頼への提案から作成したカード",
            publication_status: "unpublished",
            published_ids: [],
            latest_activity_date: req?.received_at ?? today,
            announcement_activity_ids: [],
            evidence_request_ids: isNominee && req ? [req.id] : [],
            pending_themes: [],
            outreach_history: [],
            reviewed: false,
            reviewed_at: null,
            edited_fields: [],
            created_at: now,
            updated_at: now,
            employee: cand
              ? { id: c.employee_id, name: cand.name, business_unit: cand.business_unit, role: cand.role, past_talk_count: cand.past_talk_count, last_talk_date: cand.last_talk_date, busy_text: cand.busy_text }
              : null,
            evidence: [],
            announcements: [],
            published: [],
          };
          created.push(card);
          lastCards = [...lastCards, card];
          cardId = card.card_id;
        }
      }
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
    async people() {
      const rows = await real.people();
      return rows.map((r) => {
        const o = personOverlay.get(r.id);
        return o ? { ...r, expertise_tags: o.expertise_tags ?? r.expertise_tags, speaking_intent: o.speaking_intent ?? r.speaking_intent, reviewed: true } : r;
      });
    },
    async person(id) {
      const d = await real.person(id);
      return { ...d, person: applyPerson(d.person) };
    },
    async editPerson(id, p) {
      await wait(200);
      const d = await real.person(id);
      const cur = applyPerson(d.person);
      if (p.expertise_tags && p.expertise_tags.length === 0) throw new Error("得意分野を1つ以上入れてください");
      const changed = (Object.keys(p) as Array<keyof PersonPatch>).filter((k) => JSON.stringify(p[k]) !== JSON.stringify(cur[k]));
      const prev = personOverlay.get(id);
      personOverlay.set(id, { ...prev, ...p, edited_fields: [...new Set([...(prev?.edited_fields ?? []), ...changed])] });
      return applyPerson(d.person);
    },
    async archive() {
      return real.archive();
    },
    // ---- 担当者未定のネタ：一覧はサーバーから読むだけ。割り当ては手元だけ（その人のカードを作って一覧から外す）
    async unassigned() {
      return (await real.unassigned()).filter((c) => !assigned.has(c.card_id));
    },
    async assignUnassigned(cardId, employeeId) {
      await wait(200);
      const u = (await real.unassigned()).find((c) => c.card_id === cardId);
      if (!u || assigned.has(cardId)) throw new Error("その担当者未定のネタはありません");
      await ensureCards();
      const people = await real.people();
      const p = people.find((x) => x.id === employeeId);
      if (!p) throw new Error("その社員はいません");
      const now = new Date().toISOString();
      const n = lastCards.filter((c) => c.employee_id === employeeId).length + 1;
      const card: NotebookCard = {
        card_id: `card-${employeeId}-${String(n).padStart(2, "0")}`,
        employee_id: employeeId,
        summary: u.summary,
        themes: u.themes,
        evidence_activity_ids: [],
        format: u.format,
        format_reason: u.format_reason,
        publication_status: "unpublished",
        published_ids: [],
        latest_activity_date: u.release_notes[0]?.date ?? today,
        announcement_activity_ids: [],
        evidence_request_ids: [],
        pending_themes: [],
        outreach_history: [],
        reviewed: true,
        reviewed_at: now,
        edited_fields: [],
        created_at: now,
        updated_at: now,
        employee: { id: employeeId, name: p.name, business_unit: p.business_unit, role: "", past_talk_count: p.past_talk_count, last_talk_date: null, busy_text: "予定は不明" },
        evidence: [],
        announcements: [],
        published: [],
      };
      created.push(card);
      lastCards = [...lastCards, card];
      assigned.add(cardId);
      return { card_id: card.card_id };
    },
    // アンケートの声：保存済みの分析結果（6イベント）から、サーバーと同じ関数で作る
    async voices() {
      await ensureCards();
      const evs = await real.events();
      const cards = lastCards
        .map(apply)
        .sort((a, b) => (a.latest_activity_date < b.latest_activity_date ? 1 : -1))
        .map((c) => ({ card_id: c.card_id, employee_id: c.employee_id, name: c.employee?.name ?? c.employee_id, themes: [...c.themes, ...c.pending_themes] }));
      return Object.entries(POSTEVENT)
        .flatMap(([eventId, f]) => {
          const ev = evs.find((e) => e.id === eventId);
          if (!ev) return [];
          return f.voices.map((v) => {
            const c = cards.find((x) => x.card_id === v.match_card_id);
            return { text: v.text, count: v.count, event_id: ev.id, event_title: ev.title, event_date: ev.date, sample: true, match: c ? { card_id: c.card_id, employee_id: c.employee_id, name: c.name } : null };
          });
        })
        .sort((x, y) => (x.event_date === y.event_date ? y.count - x.count : x.event_date < y.event_date ? 1 : -1));
    },
    async archiveDetail(kind, id) {
      return real.archiveDetail(kind, id);
    },
    async resolvePending(cardId, theme, accept) {
      await wait(200);
      patch(cardId, (c) => ({
        pending_themes: c.pending_themes.filter((t) => t !== theme),
        themes: accept ? [...c.themes, theme].slice(-3) : c.themes,
      }));
    },
    // ---- イベント後のアンケート（保存済みの分析結果を再生。書き戻しはメモリの中だけ）
    async events() {
      const list = await real.events();
      return list.map((e) => ({ ...e, analyzed: analyzed.has(e.id) }));
    },
    async eventDetail(id) {
      const d = await real.eventDetail(id);
      // 再生した分析は手元だけ：イベント単位の集計（overview）の形にして見せる
      const a = analyzed.get(id);
      return { ...d, overview: { ...d.overview, analysis: a ?? null } };
    },
    async analyzeEvent(id, onEvent) {
      const f = POSTEVENT[id];
      const emit = async (e: SurveyEvent, ms = 500) => {
        await wait(ms);
        onEvent(e);
      };
      if (!f) {
        await emit({ type: "error", message: "このイベントには保存済みの分析結果がありません（モックでは再生できません）" }, 200);
        return;
      }
      const st = (await real.eventDetail(id)).overview.stats;
      await emit({ type: "start", run_id: "mock-survey", model: f.model, event_id: id, talks: st.talks, answers: st.answers, sentences: f.sentences, excluded: st.excluded }, 100);
      await emit({ type: "step", n: 1, max: 3 }, 1500);
      total += f.run_usd;
      await emit({ type: "usage", run_usd: f.run_usd, total_usd: total }, 100);
      if (!lastCards.length) await this.cards();
      for (const [cardId, c] of Object.entries(f.cards)) {
        if (!lastCards.some((x) => x.card_id === cardId)) continue;
        patch(cardId, (x) => {
          const ids = new Set(c.reactions.map((r) => r.id));
          const known = new Set([...x.themes, ...x.pending_themes]);
          return {
            reactions: [...(x.reactions ?? []).filter((r) => !ids.has(r.id)), ...c.reactions],
            pending_themes: [...x.pending_themes, ...c.pending_themes_added.filter((t) => !known.has(t))],
          };
        });
      }
      for (const w of f.writebacks) await emit({ type: "writeback", message: w }, 250);
      analyzed.set(id, f.overview);
      await emit({ type: "done", overview: f.overview, run_usd: f.run_usd, total_usd: total }, 100);
    },
    async importSurvey(id, csv) {
      // モックでは Agent に聞かず、保存もしない（列の読み取り結果を見せるだけ）
      const res = await fetch(`/api/events/${encodeURIComponent(id)}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, save: false, ask: false }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "取り込めませんでした");
      return j;
    },
    async resolveReaction(cardId, reactionId, accept) {
      await wait(200);
      patch(cardId, (c) => ({
        reactions: (c.reactions ?? []).map((r) => (r.id === reactionId ? { ...r, status: accept ? "adopted" : "dismissed" } : r)),
      }));
    },
  };
}
