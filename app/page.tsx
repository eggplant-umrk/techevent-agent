"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickApi, realApi, type Api } from "@/app/_client/api";
import type {
  AgentEvent,
  BlogIdea,
  Candidate,
  DeclineReason,
  InboxDetail,
  InboxListItem,
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
import { EventsView } from "@/components/Events";
import { Inbox } from "@/components/Inbox";
import { usd } from "@/components/labels";
import { Notebook, type NbLogLine } from "@/components/Notebook";
import { AlternativePitch, Candidates } from "@/components/Proposal";
import { RequestInput, type RequestMode } from "@/components/RequestInput";

const msg = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function Home() {
  const [api, setApi] = useState<Api>(realApi);
  const [debug, setDebug] = useState(false);
  const [view, setView] = useState<View>("requests");

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

  // inbox
  const [inboxItems, setInboxItems] = useState<InboxListItem[]>([]);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [inboxId, setInboxId] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxDetail | null>(null);
  const [adding, setAdding] = useState(false);

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

  useEffect(() => {
    setApi(pickApi());
    setDebug(new URLSearchParams(window.location.search).has("debug"));
  }, []);

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

  const loadInbox = useCallback(async () => {
    try {
      setInboxItems(await api.inbox());
    } catch {
      /* 一覧は前の内容のまま */
    } finally {
      setInboxLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    api.requests().then(setPresets).catch(() => setPresets([]));
    loadCards();
    loadState();
    loadInbox();
  }, [api, loadCards, loadState, loadInbox]);

  // 受信箱は数秒ごとに見直す（Slackから届いた依頼や、準備が終わった依頼をすぐ出すため。サーバー内の読み込みだけでAPI代はかからない）
  useEffect(() => {
    const t = setInterval(loadInbox, 4000);
    return () => clearInterval(t);
  }, [loadInbox]);

  // ?inbox={id} で開いたら、その依頼の候補画面を開く
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("inbox");
    if (id) openInbox(id);
    // api が決まったときに1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  // 開いている依頼が準備中なら、一覧で準備が終わったのを見て中身を読み直す
  useEffect(() => {
    if (mode !== "inbox" || !inboxId || inbox?.status !== "processing") return;
    const now = inboxItems.find((x) => x.id === inboxId);
    if (now && now.status !== "processing") void showInbox(inboxId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxItems]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSeconds(Math.round((Date.now() - started.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [running]);

  const candidateIds = useMemo(() => new Set((result?.candidates ?? []).flatMap((c) => (c.card_id ? [c.card_id] : []))), [result]);
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
  const requestRef = () =>
    mode === "inbox" && inboxId
      ? { request_id: inboxId }
      : mode === "preset"
        ? { request_id: selected }
        : { request_id: customId, custom_text: customText };

  function resetPanel() {
    setLog([]);
    setResult(null);
    setPitch(null);
    setApproved(null);
    setApprovedCardId(null);
    setDraft(null);
    setDraftError(null);
    setDraftNote(null);
    setRunUsd(0);
  }

  /** 受信箱の1件を読み、保存してある候補と作業ログをそのまま出す（もう一度は実行しない） */
  async function showInbox(id: string) {
    try {
      const d = await api.inboxDetail(id);
      setInbox(d);
      resetPanel();
      if (d.status === "ready" && d.result) {
        for (const e of d.events) handle(e);
        setResult(d.result);
        setPitch(d.result.alternative_pitch ?? null);
      } else if (d.status === "error") {
        for (const e of d.events) if (e.type !== "error") handle(e);
      }
    } catch (err) {
      setLog([{ kind: "note", tone: "error", text: `受信箱の依頼を開けませんでした（${msg(err, "不明なエラー")}）。` }]);
    }
  }

  async function openInbox(id: string) {
    setMode("inbox");
    setInboxId(id);
    setInbox(null);
    const url = new URL(window.location.href);
    url.searchParams.set("inbox", id);
    window.history.replaceState(null, "", url);
    await showInbox(id);
    try {
      await api.inboxOpen(id);
    } catch {
      /* 印が付かなくても表示は続ける */
    }
    loadInbox();
  }

  /** 手で追加：受信箱に入れ、そのまま開いて準備の様子を見せる */
  async function addManual() {
    const text = customText.trim();
    if (!text) return;
    setAdding(true);
    try {
      const { id } = await api.inboxAdd(text);
      setCustomText("");
      await loadInbox();
      await openInbox(id);
    } catch (err) {
      setLog([{ kind: "note", tone: "error", text: `受信箱に追加できませんでした（${msg(err, "不明なエラー")}）。もう一度押してください。` }]);
    } finally {
      setAdding(false);
    }
  }

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
    const id = mode === "inbox" && inboxId ? inboxId : mode === "custom" ? `custom-${Date.now().toString(36)}` : selected;
    if (mode === "custom") setCustomId(id);
    started.current = Date.now();
    setSeconds(0);
    setRunning(true);
    resetPanel();
    try {
      await api.runAgent(mode === "custom" ? { request_id: id, custom_text: customText } : { request_id: id }, handle);
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
        debug={debug}
        runUsd={runUsd}
        totalUsd={totalUsd}
        models={models}
        pending={pending}
        updating={nbRunning}
        onUpdate={updateNotebook}
        mock={api.mock}
      />
      {loadError && (
        <p className="banner banner-error" role="alert">
          {loadError}
        </p>
      )}

      {view === "requests" && <Inbox items={inboxItems} loaded={inboxLoaded} openId={mode === "inbox" ? inboxId : null} onOpen={(id) => void openInbox(id)} />}

      <main className="main">
        {view === "events" ? (
          <EventsView api={api} onOpenCard={(id) => openCard(id)} onCardsChanged={() => void loadCards()} />
        ) : (
          <>
        <Notebook
          cards={cards}
          units={units}
          loaded={loaded}
          candidateIds={candidateIds}
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
                inbox={inbox}
                adding={adding}
                onAdd={addManual}
                compact={running || !!result}
              >
                {(log.length > 0 || running) && <AgentSteps log={log} running={running} seconds={seconds} result={result} />}
              </RequestInput>
              {result && <Candidates result={result} disabled={drafting} onApprove={approve} onOpenCard={(id, ev) => openCard(id, ev ?? null)} />}
              {result && pitch && <AlternativePitch text={pitch} />}
            </>
          )}
        </div>
          </>
        )}
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
          onResolveReaction={async (reactionId, accept) => {
            await api.resolveReaction(detailCard.card_id, reactionId, accept);
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
