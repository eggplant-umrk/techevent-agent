"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEvent, CandidateCard, ProposalResult } from "@/lib/agent";
import type { Card, DeclineReason, OutreachResult } from "@/lib/cards";
import type { SpeakingRequest } from "@/lib/data";
import type { OutreachDraft } from "@/lib/heavy";
import type { NotebookEvent } from "@/lib/notebook";
import type { ModelChoice } from "@/lib/usage";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
const PATTERN_LABEL: Record<string, string> = { open_slot: "枠だけ", theme_specified: "テーマ指定", named_speaker: "指名" };
const STATUS_LABEL: Record<string, string> = { unpublished: "未発信", blogged: "ブログ済み", talked: "登壇済み" };
const FORMAT_LABEL: Record<string, string> = { talk: "登壇", lt: "LT", blog: "ブログ" };
const RESULT_LABEL: Record<OutreachResult, string> = { approved: "承認", accepted: "承諾", declined: "辞退", published: "公開" };
const REASON_LABEL: Record<DeclineReason, string> = {
  theme_mismatch: "テーマが合わない",
  busy: "忙しい",
  schedule_conflict: "予定が重なる",
  other: "その他",
};
const ACTIVITY_LABEL: Record<string, string> = { slack_post: "Slack", github_pr: "PR", design_doc: "設計", weekly_report: "週報" };
const TOOL_LABEL: Record<string, string> = {
  search_cards: "ネタ帳を検索",
  get_card: "カードを開く",
  search_activities: "投稿を検索",
  list_employees: "社員を絞り込む",
  get_employee: "社員の詳細",
  get_speaking_history: "登壇履歴",
  check_schedule: "予定の確認",
  get_published: "発信済みの確認",
  submit_candidates: "候補を提出",
};

type NotebookCard = Card & {
  employee: { id: string; name: string; business_unit: string; role: string; past_talk_count: number; last_talk_date: string | null; workload: number } | null;
  evidence: Array<{ id: string; type: string; date: string; title: string; body: string; where: string | null }>;
  announcements: Array<{ id: string; date: string; title: string }>;
  published: Array<{ id: string; date: string; genre: string; title: string; url: string }>;
};

type LogItem =
  | { kind: "step"; n: number; max: number }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; summary?: string; ok?: boolean }
  | { kind: "note"; text: string; tone: "info" | "warn" | "error" | "ok" };

type BlogIdea = { card_id: string; title: string; why_easy_to_blog: string; outline: string[] };

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

function inputPreview(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "search_cards" || name === "search_activities") {
    const f = i.filter && typeof i.filter === "object" ? Object.keys(i.filter as object).join(",") : "";
    return `「${i.query}」${f ? `（${f}）` : ""}`;
  }
  if (name === "get_card") return String(i.card_id ?? "");
  if (name === "check_schedule") return `${i.id} ${i.date}`;
  if (name === "get_published") return String(i.author_id ?? "");
  if (name === "submit_candidates") return "";
  if ("id" in i) return String(i.id);
  return "";
}

async function readNdjson<T>(res: Response, onEvent: (e: T) => void) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) onEvent(JSON.parse(line) as T);
    }
  }
}

function Copy({ text, label = "コピー" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? "コピーしました" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Notebook card (left pane)
// ---------------------------------------------------------------------------
function CardView({
  card,
  open,
  highlight,
  onToggle,
  onSaved,
}: {
  card: NotebookCard;
  open: boolean;
  highlight: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(card.summary);
  const [themes, setThemes] = useState(card.themes.join("\n"));
  const [format, setFormat] = useState(card.format);
  const [formatReason, setFormatReason] = useState(card.format_reason);
  const [error, setError] = useState<string | null>(null);
  const [showBody, setShowBody] = useState<string | null>(null);
  const e = card.employee;

  useEffect(() => {
    setSummary(card.summary);
    setThemes(card.themes.join("\n"));
    setFormat(card.format);
    setFormatReason(card.format_reason);
  }, [card]);

  async function save() {
    setError(null);
    const res = await fetch("/api/cards", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card_id: card.card_id,
        patch: { summary, themes: themes.split("\n").map((s) => s.trim()).filter(Boolean), format, format_reason: formatReason },
      }),
    });
    const j = await res.json();
    if (!res.ok) return setError(j.error);
    setEditing(false);
    onSaved();
  }

  async function resolve(theme: string, accept: boolean) {
    setError(null);
    const res = await fetch("/api/cards/pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_id: card.card_id, theme, accept }),
    });
    const j = await res.json();
    if (!res.ok) return setError(j.error);
    onSaved();
  }

  return (
    <article id={`card-${card.card_id}`} className={`nb-card${open ? " open" : ""}${highlight ? " hl" : ""}`}>
      <button className="nb-head" onClick={onToggle} aria-expanded={open}>
        <div className="nb-who">
          <b>{e?.name}</b>
          <span className="muted small">
            {e?.business_unit}・登壇{e?.past_talk_count}回・忙しさ{e?.workload}
          </span>
        </div>
        <div className="nb-chips">
          <span className={`chip ${card.publication_status === "unpublished" ? "accent" : ""}`}>{STATUS_LABEL[card.publication_status]}</span>
          {card.reviewed && <span className="chip ok">確認済み</span>}
          {card.pending_themes.length > 0 && <span className="chip warn">新しいテーマ案 {card.pending_themes.length}</span>}
          {card.outreach_history.length > 0 && <span className="chip">打診{card.outreach_history.length}</span>}
        </div>
        <div className="nb-theme">{card.themes[0]}</div>
      </button>

      {open && (
        <div className="nb-body">
          {!editing ? (
            <>
              <p className="nb-summary">{card.summary}</p>
              <div className="label">話せるテーマ案</div>
              <ul className="tight">
                {card.themes.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              {card.pending_themes.length > 0 && (
                <div className="pending">
                  <div className="label">新しいテーマ案（未確認）</div>
                  {card.pending_themes.map((t) => (
                    <div key={t} className="pending-row">
                      <span>{t}</span>
                      <button className="btn small" onClick={() => resolve(t, true)}>
                        採用
                      </button>
                      <button className="btn small ghost" onClick={() => resolve(t, false)}>
                        却下
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="label">おすすめの形</div>
              <p className="small">
                {FORMAT_LABEL[card.format]}：{card.format_reason}
              </p>
            </>
          ) : (
            <div className="edit">
              <label className="label">要約</label>
              <textarea className="input" rows={3} value={summary} onChange={(ev) => setSummary(ev.target.value)} />
              <label className="label">テーマ案（1行に1つ、3つまで）</label>
              <textarea className="input" rows={3} value={themes} onChange={(ev) => setThemes(ev.target.value)} />
              <label className="label">おすすめの形</label>
              <div className="row">
                <select className="input" value={format} onChange={(ev) => setFormat(ev.target.value as Card["format"])}>
                  {Object.entries(FORMAT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input className="input" value={formatReason} onChange={(ev) => setFormatReason(ev.target.value)} />
              </div>
            </div>
          )}

          <div className="label">根拠の投稿</div>
          {card.evidence.length === 0 && <p className="muted small">（発信済みの記録がもとになっているカードです）</p>}
          <ul className="tight">
            {card.evidence.map((ev) => (
              <li key={ev.id}>
                <button className="linkish" onClick={() => setShowBody(showBody === ev.id ? null : ev.id)}>
                  <span className="chip small">{ACTIVITY_LABEL[ev.type] ?? ev.type}</span> {ev.title}
                  <span className="muted">（{ev.date}）</span>
                </button>
                {showBody === ev.id && (
                  <div className="quote">
                    {ev.body}
                    <div className="muted small">
                      {ev.id}・{ev.where}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {(card.published.length > 0 || card.announcements.length > 0) && (
            <>
              <div className="label">発信の記録</div>
              <ul className="tight">
                {card.published.map((p) => (
                  <li key={p.id}>
                    {p.genre}「{p.title}」<span className="muted">（{p.date}）</span>
                  </li>
                ))}
                {card.announcements.map((a) => (
                  <li key={a.id} className="muted">
                    告知：{a.title}（{a.date}）
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="label">打診履歴</div>
          {card.outreach_history.length === 0 ? (
            <p className="muted small">まだありません</p>
          ) : (
            <ul className="tight">
              {card.outreach_history.map((h, i) => (
                <li key={i}>
                  {h.date} {h.request_id}：<b>{RESULT_LABEL[h.result]}</b>
                  {h.reason && `（${REASON_LABEL[h.reason]}）`}
                  {h.event_date && <span className="muted">　開催 {h.event_date}</span>}
                </li>
              ))}
            </ul>
          )}
          {error && <div className="log-note error">{error}</div>}
          <div className="row">
            {!editing ? (
              <button className="btn small" onClick={() => setEditing(true)}>
                カードを直す
              </button>
            ) : (
              <>
                <button className="btn small primary-sm" onClick={save}>
                  保存して確認済みにする
                </button>
                <button className="btn small ghost" onClick={() => setEditing(false)}>
                  やめる
                </button>
              </>
            )}
            <span className="muted small">
              更新 {card.updated_at.slice(0, 10)}
              {card.edited_fields.length > 0 &&
                `・人が直した項目：${card.edited_fields
                  .map((f) => ({ summary: "要約", themes: "テーマ案", format: "形", format_reason: "形の理由", evidence: "根拠" })[f] ?? f)
                  .join("、")}`}
            </span>
          </div>
        </div>
      )}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Home() {
  // notebook
  const [cards, setCards] = useState<NotebookCard[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [fUnpublished, setFUnpublished] = useState(false);
  const [fNoTalk, setFNoTalk] = useState(false);
  const [fUnit, setFUnit] = useState("");
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [nbRunning, setNbRunning] = useState(false);
  const [nbLog, setNbLog] = useState<Array<{ text: string; tone: "info" | "ok" | "warn" | "error" }>>([]);
  const [pending, setPending] = useState(0);
  const [blog, setBlog] = useState<BlogIdea[] | null>(null);
  const [blogBusy, setBlogBusy] = useState(false);

  // request panel
  const [presets, setPresets] = useState<SpeakingRequest[]>([]);
  const [selected, setSelected] = useState("req001");
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [customText, setCustomText] = useState("");
  const [customId, setCustomId] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogItem[]>([]);
  const [result, setResult] = useState<ProposalResult | null>(null);
  const [pitch, setPitch] = useState<string | null>(null);
  const [approved, setApproved] = useState<CandidateCard | null>(null);
  const [approvedCardId, setApprovedCardId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OutreachDraft | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [recorded, setRecorded] = useState<string | null>(null);

  // cost
  const [runUsd, setRunUsd] = useState(0);
  const [totalUsd, setTotalUsd] = useState(0);
  const [models, setModels] = useState<ModelChoice | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  const loadCards = useCallback(async () => {
    const j = (await fetch("/api/cards").then((r) => r.json())) as { cards: NotebookCard[]; units: string[] };
    setCards(j.cards);
    setUnits(j.units);
  }, []);
  const loadState = useCallback(async () => {
    const s = (await fetch("/api/state").then((r) => r.json())) as { models: ModelChoice; pending_employees: number };
    setModels(s.models);
    setTotalUsd(s.models.totalUsd);
    setPending(s.pending_employees);
  }, []);

  useEffect(() => {
    fetch("/api/requests")
      .then((r) => r.json())
      .then(setPresets);
    loadCards();
    loadState();
  }, [loadCards, loadState]);
  useEffect(() => logEnd.current?.scrollIntoView({ block: "nearest" }), [log]);

  const candidateCardIds = useMemo(() => new Set(result?.candidates.map((c) => c.card_id).filter(Boolean) as string[]), [result]);
  const visible = cards.filter(
    (c) =>
      (!fUnpublished || c.publication_status === "unpublished") &&
      (!fNoTalk || (c.employee?.past_talk_count ?? 0) === 0) &&
      (!fUnit || c.employee?.business_unit === fUnit),
  );
  const current = presets.find((p) => p.id === selected);
  const requestRef = () => (mode === "preset" ? { request_id: selected } : { request_id: customId, custom_text: customText });

  function focusCard(cardId: string | null) {
    if (!cardId) return;
    setFUnpublished(false);
    setFNoTalk(false);
    setFUnit("");
    setOpenCard(cardId);
    setTimeout(() => document.getElementById(`card-${cardId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }

  // ---- notebook actions
  async function updateNotebook() {
    setNbRunning(true);
    setNbLog([]);
    setRunUsd(0);
    const res = await fetch("/api/notebook", { method: "POST" });
    await readNdjson<NotebookEvent>(res, (e) => {
      if (e.type === "start") setNbLog([{ text: e.targets.length ? `${e.targets.length}人分の新しい活動を読みます` : "新しい活動はありません", tone: "info" }]);
      if (e.type === "employee") setNbLog((l) => [...l, { text: `${e.n}/${e.of} ${e.name}（活動${e.activity_count}件）`, tone: "info" }]);
      if (e.type === "card") setNbLog((l) => [...l, { text: e.message, tone: "ok" }]);
      if (e.type === "no_card") setNbLog((l) => [...l, { text: "カードにする取り組みはありませんでした", tone: "info" }]);
      if (e.type === "rejected") setNbLog((l) => [...l, { text: `保存しませんでした：${e.errors.join(" / ")}`, tone: "warn" }]);
      if (e.type === "error") setNbLog((l) => [...l, { text: e.message, tone: "error" }]);
      if (e.type === "usage") {
        setRunUsd(e.run_usd);
        setTotalUsd(e.total_usd);
      }
      if (e.type === "done") setNbLog((l) => [...l, { text: `完了：新規${e.created}・更新${e.updated}・確認済み${e.kept}／${usd(e.run_usd)}`, tone: "info" }]);
    });
    setNbRunning(false);
    loadCards();
    loadState();
  }

  async function blogIdeas() {
    setBlogBusy(true);
    setBlog(null);
    const res = await fetch("/api/blog-ideas", { method: "POST" });
    const j = await res.json();
    setBlogBusy(false);
    if (!res.ok) return setNbLog([{ text: j.error, tone: "error" }]);
    setBlog(j.ideas);
    setRunUsd(j.run_usd);
    setTotalUsd(j.total_usd);
  }

  // ---- request actions
  function handle(e: AgentEvent) {
    switch (e.type) {
      case "start":
        if (e.switched)
          setLog((l) => [...l, { kind: "note", tone: "warn", text: `累計が$${e.switch_usd}を超えたため、ループを ${e.loop_model}、重い仕事を ${e.heavy_model} に切り替えています` }]);
        break;
      case "step":
        setLog((l) => [...l, { kind: "step", n: e.n, max: e.max }]);
        break;
      case "thinking":
        setLog((l) => [...l, { kind: "thinking", text: e.text }]);
        break;
      case "tool_call":
        setLog((l) => [...l, { kind: "tool", id: e.id, name: e.name, input: e.input }]);
        break;
      case "tool_result":
        setLog((l) => l.map((x) => (x.kind === "tool" && x.id === e.id ? { ...x, summary: e.summary, ok: e.ok } : x)));
        break;
      case "retry":
        setLog((l) => [...l, { kind: "note", tone: "warn", text: `提出を差し戻して探し直します：${e.message}` }]);
        break;
      case "usage":
        setRunUsd(e.run_usd);
        setTotalUsd(e.total_usd);
        break;
      case "alternative_pitch":
        setPitch(e.text);
        break;
      case "final":
        setResult(e.result);
        break;
      case "error":
        setLog((l) => [...l, { kind: "note", tone: "error", text: e.message }]);
        break;
      case "done":
        setRunUsd(e.run_usd);
        setTotalUsd(e.total_usd);
        setLog((l) => [...l, { kind: "note", tone: "info", text: `完了：モデル呼び出し${e.steps}回／${usd(e.run_usd)}` }]);
        break;
    }
  }

  async function run() {
    const id = mode === "custom" ? `custom-${Date.now().toString(36)}` : selected;
    if (mode === "custom") setCustomId(id);
    setRunning(true);
    setLog([]);
    setResult(null);
    setPitch(null);
    setApproved(null);
    setApprovedCardId(null);
    setDraft(null);
    setDraftNote(null);
    setRecorded(null);
    setRunUsd(0);
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(mode === "preset" ? { request_id: id } : { request_id: id, custom_text: customText }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: "エラー" }));
      setLog([{ kind: "note", text: err.error ?? "エラー", tone: "error" }]);
      setRunning(false);
      return;
    }
    await readNdjson<AgentEvent>(res, handle);
    setRunning(false);
    loadState();
  }

  async function recordOutcome(cardId: string | null, c: CandidateCard, r: OutreachResult, reason?: DeclineReason) {
    const res = await fetch("/api/outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestRef(),
        request_id: result!.request_id,
        card_id: cardId,
        result: r,
        reason,
        candidate: { employee_id: c.employee_id, theme: c.theme, reason: c.reason, evidence_activity_ids: c.evidence.map((x) => x.id) },
      }),
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error);
    loadCards();
    return j.card as Card;
  }

  async function approve(c: CandidateCard) {
    if (!result) return;
    setApproved(c);
    setDraft(null);
    setDraftNote(null);
    setRecorded(null);
    setDrafting(true);
    try {
      const card = await recordOutcome(c.card_id, c, "approved");
      setApprovedCardId(card.card_id);
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...requestRef(),
          run_id: result.run_id,
          candidate: { employee_id: c.employee_id, theme: c.theme, reason: c.reason, evidence_activity_ids: c.evidence.map((x) => x.id) },
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "下書きを作れませんでした");
      setDraft(j.draft);
      setSubject(j.draft.subject);
      setMessage(j.draft.message);
      if (j.fell_back) setDraftNote(`重いモデルが使えなかったため ${j.model} で作り直しました`);
      setRunUsd(j.run_usd);
      setTotalUsd(j.total_usd);
    } catch (err) {
      setDraftNote(err instanceof Error ? err.message : "エラー");
    } finally {
      setDrafting(false);
    }
  }

  async function record(r: OutreachResult, reason?: DeclineReason) {
    if (!approved) return;
    try {
      await recordOutcome(approvedCardId, approved, r, reason);
      setRecorded(`${approved.name}さんのカードに「${RESULT_LABEL[r]}${reason ? `（${REASON_LABEL[reason]}）` : ""}」を書き戻しました`);
    } catch (err) {
      setRecorded(err instanceof Error ? err.message : "エラー");
    }
  }

  const outlineText = draft
    ? draft.lt_outline.map((s) => `${s.minutes}分　${s.heading}\n${s.points.map((p) => `・${p}`).join("\n")}`).join("\n")
    : "";

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1>ネタ帳Agent</h1>
          <p className="sub">Agentが社内の取り組みをカードにまとめ続けます。依頼を貼れば、カードから候補と声かけの下書きを出します。送信はしません。</p>
        </div>
        <div className="meter">
          <div>
            <span className="meter-label">今回の金額</span>
            <span className="meter-value">{usd(runUsd)}</span>
          </div>
          <div>
            <span className="meter-label">累計</span>
            <span className="meter-value">{usd(totalUsd)}</span>
          </div>
          {models && (
            <div className="meter-models">
              ループ: {models.loop}
              <br />
              重い仕事: {models.heavy}
            </div>
          )}
        </div>
      </header>
      {models?.switched && (
        <div className="banner warn">
          累計が ${models.switchUsd} を超えたため、安いモデルに自動で切り替えています（ループ {models.loop}／重い仕事 {models.heavy}）
        </div>
      )}

      <div className="split">
        {/* ------------------------------------------------ left: notebook */}
        <section className="pane notebook">
          <div className="pane-head">
            <h2>ネタ帳 <span className="muted small">{visible.length}/{cards.length}枚</span></h2>
            <div className="row">
              <button className="btn small" onClick={updateNotebook} disabled={nbRunning}>
                {nbRunning ? "更新中…" : `ネタ帳を更新${pending ? `（${pending}人分）` : ""}`}
              </button>
              <button className="btn small" onClick={blogIdeas} disabled={blogBusy}>
                {blogBusy ? "考え中…" : "ブログのネタを出す"}
              </button>
            </div>
          </div>
          <div className="filters">
            <label>
              <input type="checkbox" checked={fUnpublished} onChange={(e) => setFUnpublished(e.target.checked)} /> 未発信だけ
            </label>
            <label>
              <input type="checkbox" checked={fNoTalk} onChange={(e) => setFNoTalk(e.target.checked)} /> 登壇経験なし
            </label>
            <select className="input small" value={fUnit} onChange={(e) => setFUnit(e.target.value)}>
              <option value="">すべての事業部</option>
              {units.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          {nbLog.length > 0 && (
            <div className="nb-log">
              {nbLog.map((l, i) => (
                <div key={i} className={`log-note ${l.tone}`}>
                  {l.text}
                </div>
              ))}
            </div>
          )}

          {blog && (
            <div className="blog">
              <div className="label">ブログにしやすい未発信のカード</div>
              {blog.length === 0 && <p className="muted small">未発信のカードがありません</p>}
              {blog.map((b) => {
                const c = cards.find((x) => x.card_id === b.card_id);
                return (
                  <div key={b.card_id} className="blog-item">
                    <div>
                      <b>{b.title}</b>
                    </div>
                    <div className="small">
                      {c?.employee?.name}・{b.why_easy_to_blog}
                    </div>
                    <ol className="tight small">
                      {b.outline.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ol>
                    <button className="linkish small" onClick={() => focusCard(b.card_id)}>
                      カードを開く
                    </button>
                  </div>
                );
              })}
              <button className="btn small ghost" onClick={() => setBlog(null)}>
                閉じる
              </button>
            </div>
          )}

          <div className="nb-list">
            {cards.length === 0 && <p className="muted">まだカードがありません。「ネタ帳を更新」を押してください。</p>}
            {visible.map((c) => (
              <CardView
                key={c.card_id}
                card={c}
                open={openCard === c.card_id}
                highlight={candidateCardIds.has(c.card_id)}
                onToggle={() => setOpenCard(openCard === c.card_id ? null : c.card_id)}
                onSaved={loadCards}
              />
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ right: request panel */}
        <section className="pane">
          <h2>依頼</h2>
          <div className="tabs">
            <button className={mode === "preset" ? "tab on" : "tab"} onClick={() => setMode("preset")}>
              届いた依頼から選ぶ
            </button>
            <button className={mode === "custom" ? "tab on" : "tab"} onClick={() => setMode("custom")}>
              依頼文を貼る
            </button>
          </div>
          {mode === "preset" ? (
            <>
              <div className="presets">
                {presets.map((p) => (
                  <button key={p.id} className={p.id === selected ? "preset on" : "preset"} onClick={() => setSelected(p.id)}>
                    <span className="chip">{PATTERN_LABEL[p.pattern ?? ""] ?? p.pattern}</span>
                    <span className="preset-title">{p.event?.title}</span>
                    <span className="preset-meta">
                      {p.event?.date}・{p.event?.format}
                      {p.event?.duration_min}分
                    </span>
                  </button>
                ))}
              </div>
              {current && (
                <div className="request-detail">
                  <div>
                    <b>{current.requester?.organization}</b>
                    <span className="muted">　{current.event?.audience}／{current.event?.venue}</span>
                  </div>
                  {current.theme && <div>テーマ：{current.theme}</div>}
                  <blockquote>{current.message}</blockquote>
                </div>
              )}
            </>
          ) : (
            <textarea
              className="input"
              rows={4}
              placeholder="例：来月のLT会でLayerXさんの枠を1つ用意しています。テーマはお任せします。"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
            />
          )}
          <button className="btn primary" disabled={running || (mode === "custom" && !customText.trim())} onClick={run}>
            {running ? "ネタ帳を探しています…" : "ネタ帳から候補を出す"}
          </button>

          {(log.length > 0 || running) && (
            <>
              <h3>作業ログ</h3>
              <div className="log">
                {log.map((item, i) => {
                  if (item.kind === "step") return <div key={i} className="log-step">ステップ {item.n}/{item.max}</div>;
                  if (item.kind === "thinking") return <div key={i} className="log-thinking">{item.text}</div>;
                  if (item.kind === "note") return <div key={i} className={`log-note ${item.tone}`}>{item.text}</div>;
                  return (
                    <div key={i} className="log-tool">
                      <span className="tool-name">{TOOL_LABEL[item.name] ?? item.name}</span>
                      <span className="tool-input">{inputPreview(item.name, item.input)}</span>
                      <span className={item.ok === false ? "tool-out bad" : "tool-out"}>{item.summary ?? "…"}</span>
                    </div>
                  );
                })}
                {running && <div className="log-note info pulse">考えています…</div>}
                <div ref={logEnd} />
              </div>
            </>
          )}

          {result && (
            <>
              <h3>候補（{PATTERN_LABEL[result.request_pattern]}）</h3>
              <p className="small">{result.summary}</p>
              {result.nominee_assessment && (
                <div className="assess">
                  <b>指名された人の確認</b>
                  <p className="small">{result.nominee_assessment}</p>
                </div>
              )}
              {result.learnings_applied.length > 0 && (
                <div className="applied">
                  <b>カードの打診履歴から反映したこと</b>
                  <ul className="tight small">
                    {result.learnings_applied.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="cand-list">
                {result.candidates.map((c) => (
                  <article key={c.employee_id} className={approved?.employee_id === c.employee_id ? "cand on" : "cand"}>
                    <div className="cand-head">
                      <span className="rank">{c.rank}</span>
                      <div className="grow">
                        <b>{c.name}</b>
                        <span className="muted small">
                          　{c.business_unit}・登壇{c.past_talk_count}回・忙しさ{c.workload}
                        </span>
                      </div>
                      {c.is_alternative_to_nominee && <span className="chip accent">代わりの提案</span>}
                      {c.card?.reviewed && <span className="chip ok">確認済み</span>}
                      {c.card && <span className="chip">{STATUS_LABEL[c.card.publication_status]}</span>}
                    </div>
                    <div className="theme">{c.theme}</div>
                    <p className="reason">{c.reason}</p>
                    <div className="small">
                      根拠：
                      {c.evidence.map((ev, i) => (
                        <span key={ev.id}>
                          {i > 0 && "、"}
                          <button className="linkish" onClick={() => focusCard(c.card_id)}>
                            {ev.title}
                          </button>
                        </span>
                      ))}
                      {c.evidence.length === 0 && c.card && (
                        <button className="linkish" onClick={() => focusCard(c.card_id)}>
                          発信済みの記録（カードを開く）
                        </button>
                      )}
                    </div>
                    {c.cautions.length > 0 && <div className="cautions small">注意：{c.cautions.join("／")}</div>}
                    <div className="row">
                      <button className="btn small primary-sm" disabled={drafting} onClick={() => approve(c)}>
                        {approved?.employee_id === c.employee_id ? "承認済み" : "この人で承認"}
                      </button>
                      {c.card_id && (
                        <button className="btn small ghost" onClick={() => focusCard(c.card_id)}>
                          カードを開く
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              {result.no_fit && (
                <div className="assess warnbox">
                  <b>{result.candidates.length === 0 ? "合う候補が見つかりませんでした" : `合う候補は${result.candidates.length}人でした`}</b>
                  <div className="label">見つからない理由</div>
                  <ul className="tight small">
                    {result.no_fit.reasons.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                  <div className="label">次に確認すべきこと</div>
                  <ul className="tight small">
                    {result.no_fit.next_checks.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              {pitch && (
                <div className="assess">
                  <b>代わりの人を推す理由（依頼元・本人への相談用）</b>
                  <p className="pre small">{pitch}</p>
                  <Copy text={pitch} />
                </div>
              )}
            </>
          )}

          {approved && (
            <>
              <h3>声かけ文とLT構成案（下書き）</h3>
              <p className="muted small">自分の言葉に直してから、コピーして送ってください。送信ボタンはありません。</p>
              {drafting && <div className="log-note info pulse">{approved.name}さんへの下書きを作っています…</div>}
              {draftNote && <div className="log-note warn">{draftNote}</div>}
              {draft && (
                <>
                  <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="件名" />
                  <textarea className="input draft-text" rows={12} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="声かけ文" />
                  <div className="row">
                    <Copy text={`${subject}\n\n${message}`} label="声かけ文をコピー" />
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        setSubject(draft.subject);
                        setMessage(draft.message);
                      }}
                    >
                      下書きに戻す
                    </button>
                  </div>
                  <div className="outline">
                    {draft.lt_outline.map((s, i) => (
                      <div key={i} className="outline-row">
                        <span className="mins">{s.minutes}分</span>
                        <div>
                          <b>{s.heading}</b>
                          <ul className="tight small">
                            {s.points.map((p, j) => (
                              <li key={j}>{p}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ))}
                    <div>
                      <Copy text={outlineText} label="構成案をコピー" />
                    </div>
                  </div>
                  {draft.tips_for_pr.length > 0 && (
                    <div className="applied">
                      <b>声をかける前に</b>
                      <ul className="tight small">
                        {draft.tips_for_pr.map((t, i) => (
                          <li key={i}>{t}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <h3>結果をカードに書き戻す</h3>
                  <div className="row wrap">
                    <button className="btn small" onClick={() => record("accepted")}>
                      承諾
                    </button>
                    {(Object.keys(REASON_LABEL) as DeclineReason[]).map((r) => (
                      <button key={r} className="btn small" onClick={() => record("declined", r)}>
                        辞退：{REASON_LABEL[r]}
                      </button>
                    ))}
                    <button className="btn small" onClick={() => record("published")}>
                      公開した
                    </button>
                  </div>
                  {recorded && <div className="log-note ok">{recorded}</div>}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
