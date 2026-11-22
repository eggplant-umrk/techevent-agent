// 受信箱：届いた依頼を登録し、裏で候補づくり（既存の runAgent）を自動で始める。
// 状態は processing（準備中）→ ready（準備済み）／error（エラー）。
// 依頼は既存の依頼と同じ形（SpeakingRequest）に変換して流すので、承認・下書き・書き戻しはそのまま使える。
import fs from "node:fs";
import { byTimeDesc, nowJst } from "./clock";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { withPitchLater, type AgentEvent, type ProposalResult } from "./agent";
import type { SpeakingRequest } from "./data";
import { buildDateSuggestions, type DateSuggestions } from "./dateSuggest";
import { KIND_LABEL, type IntakeKind } from "./intake";
import { checkIntake, intakeHeader, undecidedNote, type IntakeExtractor, type IntakeReading } from "./intake";
import { resolveNominee, type NomineeExtractor, type NomineeReading } from "./nominee";
import { runUsd as usageOfRun } from "./usage";
import { readJsonSafe, writeJsonAtomic } from "./fileStore";
import { traceEmit, withTrace } from "./trace";
import { nextStage, progressOf, type Progress, type ProgressStage } from "./progressStage";
import { userErrorText } from "./userError";

/** 書き込み先。テストでは INBOX_FILE で別のファイルに向ける */
const FILE = () => process.env.INBOX_FILE || path.join(process.cwd(), "data", "inbox.json");
/** 準備中のまま、これより長く経ったものは中断とみなす（サーバーの再起動など） */
const STALE_MS = 15 * 60 * 1000;
const MAX_TEXT = 4000;

export type InboxSource = "slack" | "manual";
export type InboxStatus = "processing" | "ready" | "error";

export interface InboxMeta {
  channel?: string;
  ts?: string;
  user?: string;
  permalink?: string;
}

export interface InboxItem {
  id: string;
  source: InboxSource;
  /** 準備中の進み具合（段階の言葉だけ。画面に1行で出す） */
  progress?: Progress | null;
  meta: InboxMeta | null;
  text: string;
  received_at: string;
  status: InboxStatus;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  /** 画面で一度でも開いたか（「新しい依頼」の印に使う） */
  opened_at: string | null;
  /** 依頼文から読み取った指名（読み取る前は null） */
  nominee: NomineeReading | null;
  /** 会話から読み取った項目（イベント名・日程・形式・テーマ・主催者）。読み取る前・古い形の読み取りでは null */
  intake?: IntakeReading | null;
  /** 貼られた文の種類（読み取りの AI が判定）。依頼ではない・不適切なら候補づくりを走らせない。古い1件にはない（登壇の依頼） */
  kind?: IntakeKind;
  kind_reason?: string | null;
  /** 「依頼ではない」と読んだものを、人が「依頼として進める」で先に進めた */
  kind_override?: "request" | null;
  result: ProposalResult | null;
  /** 作業ログ（画面の「Agentがやったこと」を再現するため） */
  events: AgentEvent[];
  run_usd: number;
  /**
   * 代わりの人を推す文（指名の依頼で、代わりの候補がいるときだけ）。候補ができた時点で「準備済み」にし、この文は裏で作る。
   * pending＝作っている／ready＝できた（result.alternative_pitch）／error＝作れなかった／null・なし＝作らない依頼
   */
  pitch_status?: PitchStatus | null;
  /** 日程が決まっていない依頼で、候補ごとの空いていそうな日（コードで計算）。日程が決まっている・候補がいなければ null */
  date_suggestions?: DateSuggestions | null;
}

export type PitchStatus = "pending" | "ready" | "error";

export type Runner = (request: SpeakingRequest, emit: (e: AgentEvent) => void) => Promise<ProposalResult | null>;

/** 代わりの人を推す文を作る（既定は lib/heavy.ts の alternativePitch。テストでは差し替える） */
export type Pitcher = (
  runId: string,
  request: SpeakingRequest,
  nomineeAssessment: string | null,
  alternatives: Array<{ employee_id: string; theme: string; reason: string }>,
) => Promise<{ value: string; model: string; fellBack: boolean }>;

const defaultPitcher: Pitcher = async (...args) => (await import("./heavy")).alternativePitch(...args);

/** 代わりの人を推す文を作っている途中のまま、これより長く経ったものは作れなかったとみなす（サーバーの再起動など） */
const PITCH_STALE_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------
function load(): InboxItem[] {
  return readJsonSafe<InboxItem[]>(FILE(), [], "array"); // 壊れていたら退けて空として読む（落とさない）
}

function save(items: InboxItem[]) {
  writeJsonAtomic(FILE(), items); // 一時ファイルに書いてから置き換える（書きかけを残さない）
}

/**
 * サーバーの起動時に呼ぶ：前のサーバーで「準備中」のまま止まった依頼を「エラー」にして、押し直せるようにする
 * （起動した直後は、このサーバーで動いている候補づくりはない）。直した件数を返す
 */
export function recoverInterrupted(): number {
  const items = load();
  let n = 0;
  const fixed = items.map((it) => {
    if (it.status === "processing") {
      n++;
      return { ...it, status: "error" as const, error: "途中で止まりました（サーバーを起動し直したため）", progress: null, finished_at: nowJst() };
    }
    if (it.pitch_status === "pending") {
      n++;
      return { ...it, pitch_status: "error" as const };
    }
    return it;
  });
  if (n) save(fixed);
  return n;
}

/** 1件を書き換える。読み込みから書き込みまで同期なので、同じプロセス内で割り込まれない */
function update(id: string, fn: (it: InboxItem) => InboxItem) {
  const items = load();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return;
  items[i] = fn(items[i]);
  save(items);
}

function withStale(it: InboxItem): InboxItem {
  if (it.status === "processing" && Date.now() - Date.parse(it.started_at) > STALE_MS) {
    return { ...it, status: "error", error: "候補づくりが途中で止まりました（サーバーの再起動など）。もう一度探してください。" };
  }
  if (it.pitch_status === "pending" && it.finished_at && Date.now() - Date.parse(it.finished_at) > PITCH_STALE_MS) {
    return { ...it, pitch_status: "error" };
  }
  return it;
}

export function listInbox(): InboxItem[] {
  return load()
    .map(withStale)
    .sort((a, b) => byTimeDesc(a.received_at, b.received_at)); // 前の記録（…Z）と新しい記録（+09:00）が混ざっても時刻で並べる
}

export function getInboxItem(id: string): InboxItem | undefined {
  const it = load().find((x) => x.id === id);
  return it ? withStale(it) : undefined;
}

export function markOpened(id: string) {
  update(id, (it) => (it.opened_at ? it : { ...it, opened_at: nowJst() }));
}

// ---------------------------------------------------------------------------
// 既存の依頼の形にする
// ---------------------------------------------------------------------------
/**
 * 受信箱の依頼を、既存の依頼（SpeakingRequest）と同じ形にする。
 * 指名は、依頼文から読み取って社員データで確かめた人だけを入れる（指名の検証・代わりの提案は既存のまま効く）。
 * 開催日などは本文からAgentが読み取る。
 */
export function inboxRequest(
  it: Pick<InboxItem, "id" | "text" | "received_at" | "source"> & { nominee?: NomineeReading | null; intake?: IntakeReading | null },
): SpeakingRequest {
  const intake = it.intake ?? null;
  return {
    id: it.id,
    received_at: it.received_at.slice(0, 10),
    // 会話から読み取った項目があれば先頭に足す（未定は未定のまま渡す）。元の会話はそのまま続ける
    message: intake ? `${intakeHeader(intake, it.nominee ?? null)}\n${it.text}` : it.text,
    nominated_employee_id: it.nominee?.employee_id ?? null,
    ...(intake ? { intake } : {}),
  };
}

/**
 * 依頼文（X の会話など）から項目と指名を読み取り、コードで確かめる。
 * 読み取りが古い形（指名の名前だけ）なら指名だけ。失敗したら指名なし（理由を残す）、項目は読まなかったことにする。
 */
export async function readIntake(
  text: string,
  receivedAt: string,
  extractor: IntakeExtractor,
  runId: string,
): Promise<{ nominee: NomineeReading; intake: IntakeReading | null }> {
  try {
    const raw = await extractor(text, runId);
    if (raw === null || typeof raw === "string") return { nominee: resolveNominee(raw), intake: null };
    return checkIntake(text, raw, receivedAt);
  } catch {
    return {
      nominee: {
        name: null,
        employee_id: null,
        note: "依頼文から指名を読み取れなかったため、指名なしとして扱いました。指名があるかは依頼文で確認してください",
      },
      intake: null,
    };
  }
}

/** 依頼文から指名を読み取り、社員データで確かめる。読み取れなければ指名なし（理由を残す） */
export async function readNominee(text: string, extractor: NomineeExtractor, runId: string): Promise<NomineeReading> {
  try {
    return resolveNominee(await extractor(text, runId));
  } catch {
    return {
      name: null,
      employee_id: null,
      note: "依頼文から指名を読み取れなかったため、指名なしとして扱いました。指名があるかは依頼文で確認してください",
    };
  }
}

/** 指名なしとして扱った理由を、各候補の注意点に書く（候補がいなければ見つからない理由に書く） */
export function addNomineeNote(result: ProposalResult, note: string | null): ProposalResult {
  if (!note) return result;
  if (result.candidates.length === 0) {
    const nf = result.no_fit ?? { reasons: [], next_checks: [] };
    return { ...result, no_fit: { ...nf, reasons: [...nf.reasons, note] } };
  }
  return { ...result, candidates: result.candidates.map((c) => ({ ...c, cautions: [...c.cautions, note] })) };
}

// ---------------------------------------------------------------------------
// 受け取る
// ---------------------------------------------------------------------------
export interface InboxInput {
  text: string;
  source: InboxSource;
  meta?: InboxMeta;
}

/** 窓口の入力を確かめる。問題があればエラー文、なければ整えた入力を返す */
/** Slack の投稿へのリンクか（https:// で始まり、ホストが slack.com か *.slack.com）。そうなら URL を、違えば null */
export function safeSlackPermalink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (host !== "slack.com" && !host.endsWith(".slack.com")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** 入口でコードが止めるときの文（API を呼ぶ前） */
export const NO_REQUEST_TEXT = "依頼の文が見つかりません（記号だけ・URL だけの文は受け付けません。URL の中身は読みません）";
// 依頼の文がありそうかの入口のチェックは lib/requestText.ts（Slack ボットも同じものを使う）
import { hasRequestText } from "./requestText";
export { hasRequestText, MIN_MEANINGFUL_CHARS } from "./requestText";

export function parseInboxInput(body: unknown): { ok: true; input: InboxInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "JSON の本文がありません" };
  const b = body as Record<string, unknown>;
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text) return { ok: false, error: "text が空です" };
  if (text.length > MAX_TEXT) return { ok: false, error: `text は ${MAX_TEXT} 文字までです` };
  if (!hasRequestText(text)) return { ok: false, error: NO_REQUEST_TEXT };
  if (b.source !== "slack" && b.source !== "manual") return { ok: false, error: 'source は "slack" か "manual" です' };
  let meta: InboxMeta | undefined;
  if (b.meta !== undefined && b.meta !== null) {
    if (typeof b.meta !== "object") return { ok: false, error: "meta はオブジェクトです" };
    const m = b.meta as Record<string, unknown>;
    meta = {};
    for (const k of ["channel", "ts", "user", "permalink"] as const) {
      if (m[k] === undefined) continue;
      if (typeof m[k] !== "string") return { ok: false, error: `meta.${k} は文字列です` };
      meta[k] = (m[k] as string).slice(0, 500);
    }
    // Slack の投稿へのリンクだけを残す（https:// で始まり、ホストが slack.com で終わるもの）。それ以外は保存しない
    if (meta.permalink !== undefined && !safeSlackPermalink(meta.permalink)) delete meta.permalink;
  }
  return { ok: true, input: { text, source: b.source, meta } };
}

const newId = () => `inb-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

/** 登録して、裏で候補づくりを始める。返すのは登録した1件（まだ processing） */
export function addToInbox(input: InboxInput, runner: Runner, extractor?: IntakeExtractor, onSettled?: () => void): InboxItem {
  const item = registerInbox(input);
  // onSettled：裏の候補づくりが終わったら呼ぶ（API を使う操作の同時実行の数を返すため）
  void prepare(item.id, runner, extractor).finally(() => onSettled?.());
  return item;
}

/** 登録だけする（候補づくりは始めない）。評価スクリプトが自分で prepare を待つときに使う */
export function registerInbox(input: InboxInput): InboxItem {
  const now = nowJst();
  const item: InboxItem = {
    id: newId(),
    source: input.source,
    meta: input.meta ?? null,
    text: input.text,
    received_at: now,
    status: "processing",
    started_at: now,
    finished_at: null,
    error: null,
    opened_at: null,
    nominee: null,
    result: null,
    events: [],
    run_usd: 0,
  };
  save([...load(), item]);
  return item;
}

/**
 * 候補づくり。終わったら結果と作業ログを保存する（テストから待てるように Promise を返す）。
 * extractor があれば、先に依頼文から指名を読み取って既存の依頼の形に入れる。
 * 指名の依頼で代わりの候補がいるときは、候補ができた時点で「準備済み」にしてから、代わりの人を推す文を作る
 * （Promise はその文ができてから終わる。状態は pitch_status）。
 * 実行の記録（lib/trace.ts）を、依頼の id で残す（名前・時間・数・成否だけ）。
 */
export function prepare(id: string, runner: Runner, extractor?: IntakeExtractor, pitcher: Pitcher = defaultPitcher): Promise<void> {
  return withTrace(id, () => prepareTraced(id, (request, emit) => runner(request, traceEmit(emit)), extractor, pitcher));
}

async function prepareTraced(id: string, runner: Runner, extractor?: IntakeExtractor, pitcher: Pitcher = defaultPitcher): Promise<void> {
  let it = getInboxItem(id);
  if (!it) return;
  const events: AgentEvent[] = [];
  let runUsd = 0;
  let pitchJob: { request: SpeakingRequest; result: ProposalResult } | null = null;
  // 進み具合（画面に1行で出す）。作業ログの流れから段階を決め、変わったときだけ保存する
  let stage: ProgressStage = "reading";
  update(id, (x) => ({ ...x, progress: progressOf(stage) }));
  try {
    if (extractor && !it.nominee) {
      const { nominee, intake } = await readIntake(it.text, it.received_at, extractor, id);
      update(id, (x) => ({ ...x, nominee, intake }));
      it = { ...it, nominee, intake };
    }
    // 種類で止める（判定は読み取りの AI、止めるのはコード）。依頼ではない・不適切なら候補づくりを走らせない
    const kind: IntakeKind = it.intake?.kind ?? "request";
    if (kind !== "request" && !(kind === "not_request" && it.kind_override === "request")) {
      update(id, (x) => ({
        ...x,
        status: "ready",
        error: null,
        kind,
        kind_reason: it!.intake?.kind_reason ?? null,
        result: null,
        events,
        run_usd: usageOfRun(id),
        finished_at: nowJst(),
        progress: null,
      }));
      return;
    }
    update(id, (x) => ({ ...x, kind: "request", kind_reason: null }));
    const note = it.nominee?.note ?? null;
    const undecided = undecidedNote(it.intake);
    // 判断が要る依頼の注意（属性で絞らない・競合の比較・ほかの依頼は別に）は、コードが候補の注意点に足す
    const judgment = it.intake?.notes ?? [];
    const request = inboxRequest(it);
    // 代わりの人を推す文は、この中では作らない（準備済みにしてから下で作る）
    const raw = await withPitchLater(() =>
      runner(request, (e) => {
        events.push(e);
        if (e.type === "done") runUsd = e.run_usd;
        const next = nextStage(stage, e as { type: string; name?: string });
        if (next !== stage) {
          stage = next;
          update(id, (x) => ({ ...x, progress: progressOf(stage) }));
        }
      }),
    );
    const result = raw ? judgment.reduce((r, n) => addNomineeNote(r, n), addNomineeNote(addNomineeNote(raw, note), undecided)) : null;
    runUsd += usageOfRun(id); // 指名の読み取りの分（依頼の id で記録している）
    const failed = events.find((e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error");
    const needsPitch =
      !!result && !!request.nominated_employee_id && !result.alternative_pitch && result.candidates.some((c) => c.is_alternative_to_nominee);
    if (needsPitch) pitchJob = { request, result: result! };
    // 日程が決まっていなければ、候補ごとの空いていそうな日（コード。失敗しても候補はそのまま）
    const dateSuggestions = result ? await buildDateSuggestions(it.intake, result.candidates).catch(() => null) : null;
    update(id, (x) => ({
      ...x,
      status: result ? "ready" : "error",
      error: result ? null : failed?.message ?? "候補を出せませんでした",
      result,
      events,
      run_usd: runUsd,
      finished_at: nowJst(),
      pitch_status: needsPitch ? "pending" : null,
      date_suggestions: dateSuggestions,
    }));
  } catch (err) {
    update(id, (x) => ({
      ...x,
      status: "error",
      error: userErrorText(err, { where: "受信箱の候補づくり", retryLabel: "もう一度探す", fallback: "候補を出せませんでした" }),
      events,
      run_usd: runUsd,
      finished_at: nowJst(),
    }));
  }
  if (pitchJob) await makePitch(id, pitchJob.request, pitchJob.result, pitcher);
}

/** 準備済みにしたあとで、代わりの人を推す文を作って保存する。作れなくても候補はそのまま（pitch_status だけ error） */
async function makePitch(id: string, request: SpeakingRequest, result: ProposalResult, pitcher: Pitcher) {
  const alts = result.candidates.filter((c) => c.is_alternative_to_nominee);
  const before = usageOfRun(result.run_id);
  try {
    const pitch = await pitcher(result.run_id, request, result.nominee_assessment, alts);
    const cost = usageOfRun(result.run_id) - before;
    update(id, (x) => ({
      ...x,
      result: x.result ? { ...x.result, alternative_pitch: pitch.value } : x.result,
      events: [...x.events, { type: "alternative_pitch", text: pitch.value, model: pitch.model, fell_back: pitch.fellBack }],
      run_usd: x.run_usd + cost,
      pitch_status: "ready",
    }));
  } catch (e) {
    const cost = usageOfRun(result.run_id) - before;
    update(id, (x) => ({
      ...x,
      events: [...x.events, { type: "error", message: `代わりの人を推す理由を作れませんでした：${userErrorText(e, { where: "代わりの人を推す文" })}` }],
      run_usd: x.run_usd + cost,
      pitch_status: "error",
    }));
  }
}

/** もう一度探す（画面の「もう一度探す」とは別に、エラーの依頼を準備し直すとき用） */
/**
 * 「依頼ではない」と読んだ1件を、人が「依頼として進める」で先に進める（AI の読み違いに備える）。
 * 読み取った項目は使わない（未定のまま）。不適切なものは進めない
 */
export function proceedAsRequest(id: string, runner: Runner, onSettled?: () => void): { ok: true } | { ok: false; error: string } {
  const it = getInboxItem(id);
  if (!it) return { ok: false, error: "その依頼は受信箱にありません" };
  if (it.kind === "inappropriate") return { ok: false, error: "この内容には対応しません" };
  if (it.kind !== "not_request") return { ok: false, error: "この依頼はもう登壇の依頼として扱っています" };
  if (it.status === "processing") return { ok: false, error: "準備中です" };
  update(id, (x) => ({ ...x, kind_override: "request", status: "processing", started_at: nowJst(), finished_at: null, error: null }));
  void prepare(id, runner).finally(() => onSettled?.());
  return { ok: true };
}

export function restart(id: string, runner: Runner, extractor?: IntakeExtractor) {
  update(id, (x) => ({ ...x, status: "processing", started_at: nowJst(), finished_at: null, error: null }));
  void prepare(id, runner, extractor);
}

// ---------------------------------------------------------------------------
// 窓口（GET /api/inbox/{id}）の返す形
// ---------------------------------------------------------------------------
/** 窓口の返す形（docs/inbox-api.md と同じ）。
 *  候補の名前・理由・件数・見つからない理由は返さない（人選の検討は技術広報が画面で見る。Slack には書かない） */
export function publicView(it: InboxItem, origin: string) {
  return {
    id: it.id,
    status: it.status,
    url: `${origin}/?inbox=${encodeURIComponent(it.id)}`,
  };
}

// ---------------------------------------------------------------------------
// 画面用
// ---------------------------------------------------------------------------
export interface InboxListItem {
  id: string;
  source: InboxSource;
  status: InboxStatus;
  received_at: string;
  is_new: boolean;
  /** 本文の先頭（一覧に出す） */
  title: string;
  candidate_names: string[];
  no_fit: boolean;
  error: string | null;
  permalink: string | null;
  /** 準備中の進み具合（段階の言葉だけ。lib/progressStage.ts） */
  progress?: Progress | null;
  /** 貼られた文の種類（登壇の依頼／依頼ではない／不適切）。一覧で「候補なし」と見分けるため */
  kind?: IntakeKind;
  /** 種類の理由の一言と、画面に出す文 */
  kind_reason?: string | null;
  kind_label?: string | null;
}

export function listView(it: InboxItem): InboxListItem {
  // 会話からイベント名を読み取れていればそれを、なければ本文の先頭行を出す
  const firstLine = it.intake?.event_name ?? it.text.split(/\r?\n/).find((l) => l.trim()) ?? it.text;
  return {
    id: it.id,
    source: it.source,
    status: it.status,
    received_at: it.received_at,
    is_new: !it.opened_at,
    title: firstLine.length > 70 ? firstLine.slice(0, 69) + "…" : firstLine,
    candidate_names: it.result?.candidates.map((c) => c.name) ?? [],
    no_fit: !!it.result && it.result.candidates.length === 0,
    error: it.status === "error" ? it.error : null,
    // 前に保存したものも、Slack の投稿へのリンクでなければ出さない
    permalink: safeSlackPermalink(it.meta?.permalink),
    progress: it.status === "processing" ? it.progress ?? null : null,
    kind: it.kind ?? "request",
    kind_reason: it.kind && it.kind !== "request" ? it.kind_reason ?? null : null,
    kind_label: it.kind === "not_request" ? "依頼ではなさそうです" : it.kind === "inappropriate" ? "この内容には対応しません" : null,
  };
}

/** 種類の表示名（画面・ログ用） */
export const kindLabel = (k: IntakeKind) => KIND_LABEL[k];

export interface InboxDetail extends InboxListItem {
  text: string;
  /** 依頼文から読み取り、社員データで確かめた指名（社員の名前）。指名なし・確かめられなかったときは null */
  nominee_name: string | null;
  /** 会話から読み取った項目（未定の項目つき）。読み取っていなければ null */
  intake: IntakeReading | null;
  result: ProposalResult | null;
  events: AgentEvent[];
  run_usd: number;
  /** 代わりの人を推す文の状態（pending のあいだは result.alternative_pitch がまだない）。作らない依頼は null */
  pitch_status?: PitchStatus | null;
  /** 日程が決まっていない依頼の、候補ごとの空いていそうな日。reply_sentence は主催者への返事に入れてよい1文の材料（入れるかは技術広報が選ぶ） */
  date_suggestions?: DateSuggestions | null;
}

export function detailView(it: InboxItem): InboxDetail {
  const nomineeName = it.nominee?.employee_id
    ? it.result?.candidates.find((c) => c.employee_id === it.nominee!.employee_id)?.name ?? it.nominee.name
    : null;
  return {
    ...listView(it),
    text: it.text,
    nominee_name: nomineeName,
    intake: it.intake ?? null,
    result: it.result,
    // 考えた内容は画面に出さない（前に保存した作業ログに中身が残っていても「考えています」にする）
    events: it.events.map((e) => (e.type === "thinking" ? { ...e, text: "考えています" } : e)),
    run_usd: it.run_usd,
    pitch_status: it.pitch_status ?? null,
    date_suggestions: it.date_suggestions ?? null,
  };
}
