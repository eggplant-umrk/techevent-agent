"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickApi, realApi, type Api } from "@/app/_client/api";
import type {
  AgentEvent,
  BlogIdea,
  Candidate,
  DeclineReason,
  ModelChoice,
  NotebookCard,
  OutreachDraft,
  OutreachResult,
  Proposal,
  SpeakingRequest,
} from "@/app/_client/types";
import { AgentSteps, type LogItem } from "@/components/AgentSteps";
import { Approved } from "@/components/Approved";
import { CardDetail } from "@/components/CardDetail";
import { Header, type View } from "@/components/Header";
import { usd } from "@/components/labels";
import { Notebook, type NbLogLine } from "@/components/Notebook";
import { AlternativePitch, CandidateCardView, CandidateGroup, NoFit, ProposalNotes } from "@/components/Proposal";
import { RequestInput, type RequestMode } from "@/components/RequestInput";
import { HistoryView, LearningsView } from "@/components/SideViews";

const msg = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function Home() {
  const [api, setApi] = useState<Api>(realApi);
  const [view, setView] = useState<View>("notebook");

  // notebook
  const [cards, setCards] = useState<NotebookCard[]>([]);
  const [units, setUnits] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [nbRunning, setNbRunning] = useState(false);
  const [nbLog, setNbLog] = useState<NbLogLine[]>([]);
  const [blog, setBlog] = useState<BlogIdea[] | null>(null);
  const [blogBusy, setBlogBusy] = useState(false);
  const [blogError, setBlogError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; evidence: string | null } | null>(null);

  // request
  const [presets, setPresets] = useState<SpeakingRequest[]>([]);
  const [selected, setSelected] = useState("req001");
  const [mode, setMode] = useState<RequestMode>("preset");
  const [customText, setCustomText] = useState("");
  const [customId, setCustomId] = useState("");
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [log, setLog] = useState<LogItem[]>([]);
  const [result, setResult] = useState<Proposal | null>(null);
  const [pitch, setPitch] = useState<string | null>(null);

  // after approval
  const [approved, setApproved] = useState<Candidate | null>(null);
  const [approvedCardId, setApprovedCardId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OutreachDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);

  // cost
  const [runUsd, setRunUsd] = useState(0);
  const [totalUsd, setTotalUsd] = useState(0);
  const [models, setModels] = useState<ModelChoice | null>(null);
  const started = useRef(0);

  useEffect(() => setApi(pickApi()), []);

  const loadCards = useCallback(async () => {
    try {
      const j = await api.cards();
      setCards(j.cards);
      setUnits(j.units);
      setLoadError(null);
    } catch (err) {
      setLoadError(`ネタ帳を読み込めませんでした（${msg(err, "不明なエラー")}）。ページを再読み込みしてください。`);
    } finally {
      setLoaded(true);
    }
  }, [api]);
  const loadState = useCallback(async () => {
    try {
      const s = await api.state();
      setModels(s.models);
      setTotalUsd(s.models.totalUsd);
      setPending(s.pending_employees);
    } catch {
      /* the header just keeps the last numbers */
    }
  }, [api]);

  useEffect(() => {
    api.requests().then(setPresets).catch(() => setPresets([]));
    loadCards();
    loadState();
  }, [api, loadCards, loadState]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [running]);

  const candidateRanks = useMemo(
    () => new Map((result?.candidates ?? []).filter((c) => c.card_id).map((c) => [c.card_id as string, c.rank])),
    [result],
  );
  const detailCard = detail ? cards.find((c) => c.card_id === detail.id) ?? null : null;
  const openCard = (id: string, evidence: string | null = null) => setDetail({ id, evidence });

  // ---- notebook
  async function updateNotebook() {
    setNbRunning(true);
    setNbLog([]);
    setRunUsd(0);
    try {
      await api.updateNotebook((e) => {
        if (e.type === "start") setNbLog([{ text: e.targets.length ? `${e.targets.length}人分の新しい活動を読みます` : "新しい活動はありません", tone: "info" }]);
        if (e.type === "employee") setNbLog((l) => [...l, { text: `${e.n}/${e.of} ${e.name}（活動${e.activity_count}件）`, tone: "info" }]);
        if (e.type === "card") setNbLog((l) => [...l, { text: e.message, tone: "ok" }]);
        if (e.type === "no_card") setNbLog((l) => [...l, { text: "カードにする取り組みはありませんでした", tone: "info" }]);
        if (e.type === "rejected") setNbLog((l) => [...l, { text: `保存しませんでした：${e.errors.join(" / ")}`, tone: "warn" }]);
        if (e.type === "error") setNbLog((l) => [...l, { text: `${e.message}。時間をおいてもう一度「ネタ帳を更新」を押してください。`, tone: "error" }]);
        if (e.type === "usage") {
          setRunUsd(e.run_usd);
          setTotalUsd(e.total_usd);
        }
        if (e.type === "done") setNbLog((l) => [...l, { text: `完了：新規${e.created}・更新${e.updated}・確認済み${e.kept}（${usd(e.run_usd)}）`, tone: "info" }]);
      });
    } catch (err) {
      setNbLog((l) => [...l, { text: `更新できませんでした（${msg(err, "不明なエラー")}）。もう一度押してください。`, tone: "error" }]);
    }
    setNbRunning(false);
    loadCards();
    loadState();
  }

  async function blogIdeas() {
    setBlogBusy(true);
    setBlog(null);
    setBlogError(null);
    try {
      const j = await api.blogIdeas();
      setBlog(j.ideas);
      setRunUsd(j.run_usd);
      setTotalUsd(j.total_usd);
    } catch (err) {
      setBlogError(`ブログのネタを出せませんでした（${msg(err, "不明なエラー")}）。もう一度押してください。`);
    }
    setBlogBusy(false);
  }

  // ---- request
  const requestRef = () => (mode === "preset" ? { request_id: selected } : { request_id: customId, custom_text: customText });

  function handle(e: AgentEvent) {
    switch (e.type) {
      case "start":
        if (e.switched)
          setLog((l) => [...l, { kind: "note", tone: "warn", text: `累計が$${e.switch_usd}を超えたため、ループを ${e.loop_model}、重い仕事を ${e.heavy_model} に切り替えています` }]);
        break;
      case "thinking":
        if (e.text.trim()) setLog((l) => [...l, { kind: "thinking", text: e.text.trim() }]);
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
        setLog((l) => [...l, { kind: "note", tone: "error", text: `${e.message}。もう一度「ネタ帳から候補を出す」を押してください。` }]);
        break;
      case "done":
        setRunUsd(e.run_usd);
        setTotalUsd(e.total_usd);
        break;
    }
  }

  async function run() {
    const id = mode === "custom" ? `custom-${Date.now().toString(36)}` : selected;
    if (mode === "custom") setCustomId(id);
    started.current = Date.now();
    setSeconds(0);
    setRunning(true);
    setLog([]);
    setResult(null);
    setPitch(null);
    setApproved(null);
    setApprovedCardId(null);
    setDraft(null);
    setDraftError(null);
    setDraftNote(null);
    setRunUsd(0);
    try {
      await api.runAgent(mode === "preset" ? { request_id: id } : { request_id: id, custom_text: customText }, handle);
    } catch (err) {
      setLog((l) => [...l, { kind: "note", tone: "error", text: `候補を出せませんでした（${msg(err, "不明なエラー")}）。もう一度押してください。` }]);
    }
    setSeconds(Math.round((Date.now() - started.current) / 1000));
    setRunning(false);
    loadState();
  }

  const candBody = (c: Candidate) => ({ employee_id: c.employee_id, theme: c.theme, reason: c.reason, evidence_activity_ids: c.evidence.map((x) => x.id) });

  async function makeDraft(c: Candidate) {
    if (!result) return;
    setDraft(null);
    setDraftError(null);
    setDraftNote(null);
    setDrafting(true);
    try {
      const j = await api.draft({ ...requestRef(), run_id: result.run_id, candidate: candBody(c) });
      setDraft(j.draft);
      if (j.fell_back) setDraftNote(`重いモデルが使えなかったため ${j.model} で作り直しました。`);
      setRunUsd(j.run_usd);
      setTotalUsd(j.total_usd);
    } catch (err) {
      setDraftError(`声かけ文を作れませんでした（${msg(err, "不明なエラー")}）。「もう一度作る」を押してください。`);
    } finally {
      setDrafting(false);
    }
  }

  async function approve(c: Candidate) {
    if (!result) return;
    setApproved(c);
    window.scrollTo({ top: 0, behavior: "smooth" });
    try {
      const card = await api.outcome({ ...requestRef(), request_id: result.request_id, card_id: c.card_id, result: "approved", candidate: candBody(c) });
      setApprovedCardId(card.card_id);
      loadCards();
    } catch (err) {
      setDraftError(`承認を記録できませんでした（${msg(err, "不明なエラー")}）。`);
    }
    await makeDraft(c);
  }

  async function record(r: OutreachResult, reason?: DeclineReason) {
    if (!approved || !result) return;
    await api.outcome({
      ...requestRef(),
      request_id: result.request_id,
      card_id: approvedCardId ?? approved.card_id,
      result: r,
      reason,
      candidate: candBody(approved),
    });
    loadCards();
  }

  return (
    <div className="app">
      <Header
        view={view}
        onView={setView}
        runUsd={runUsd}
        totalUsd={totalUsd}
        models={models}
        pending={pending}
        updating={nbRunning}
        onUpdate={updateNotebook}
        mock={api.mock}
      />
      {models?.switched && (
        <p className="banner" role="status">
          累計が ${models.switchUsd} を超えたため、安いモデルに切り替えています（ループ {models.loop}／重い仕事 {models.heavy}）
        </p>
      )}
      {loadError && (
        <p className="banner banner-error" role="alert">
          {loadError}
        </p>
      )}

      <main className="main">
        {view === "notebook" && (
          <>
            <Notebook
              cards={cards}
              units={units}
              loaded={loaded}
              candidateRanks={candidateRanks}
              log={nbLog}
              updating={nbRunning}
              blog={blog}
              blogBusy={blogBusy}
              blogError={blogError}
              onBlog={blogIdeas}
              onCloseBlog={() => setBlog(null)}
              onOpen={(id) => openCard(id)}
            />

            <div className="panel" aria-label="依頼パネル">
              {approved ? (
                <Approved
                  candidate={approved}
                  draft={draft}
                  drafting={drafting}
                  draftError={draftError}
                  draftNote={draftNote}
                  onBack={() => {
                    setApproved(null);
                    setDraft(null);
                    setDraftError(null);
                  }}
                  onRetryDraft={() => makeDraft(approved)}
                  onRecord={record}
                />
              ) : (
                <>
                  <RequestInput
                    presets={presets}
                    selected={selected}
                    onSelect={setSelected}
                    mode={mode}
                    onMode={setMode}
                    customText={customText}
                    onCustomText={setCustomText}
                    running={running}
                    onRun={run}
                    compact={running || !!result}
                  />
                  {(log.length > 0 || running) && <AgentSteps log={log} running={running} seconds={seconds} />}
                  {result && (
                    <>
                      <ProposalNotes result={result} />
                      {result.candidates.length > 0 && (
                        <div className="row-between pad-x">
                          <h3 className="h2">候補 {result.candidates.length}人</h3>
                          <span className="meta">自信のある候補が先、条件付きの候補が後です</span>
                        </div>
                      )}
                      {result.candidates.map((c, i) => (
                        <CandidateGroup key={c.employee_id} first={i === 0 || result.candidates[i - 1].confidence !== c.confidence} conditional={c.confidence === "conditional"}>
                        <CandidateCardView
                          key={c.employee_id}
                          c={c}
                          disabled={drafting}
                          onApprove={() => approve(c)}
                          onOpenCard={(ev) => c.card_id && openCard(c.card_id, ev ?? null)}
                        />
                        </CandidateGroup>
                      ))}
                      <NoFit result={result} />
                      {pitch && <AlternativePitch text={pitch} />}
                    </>
                  )}
                  {!result && !running && log.length === 0 && (
                    <p className="hint">
                      依頼を選んで「ネタ帳から候補を出す」を押すと、Agentがネタ帳を探して候補を最大3人出します。声かけは下書きまでで、送るのは人です。
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
        {view === "history" && <HistoryView presets={presets} cards={cards} onOpen={(id) => openCard(id)} />}
        {view === "learnings" && <LearningsView cards={cards} onOpen={(id) => openCard(id)} />}
      </main>

      {detailCard && (
        <CardDetail
          key={detailCard.card_id}
          card={detailCard}
          focusEvidence={detail?.evidence ?? null}
          onClose={() => setDetail(null)}
          onSave={async (p) => {
            await api.editCard(detailCard.card_id, p);
            await loadCards();
          }}
          onResolve={async (theme, accept) => {
            await api.resolvePending(detailCard.card_id, theme, accept);
            await loadCards();
          }}
        />
      )}
    </div>
  );
}
