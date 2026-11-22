"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReadyNotices } from "@/components/ReadyNotices";
import type { CandidateMark } from "@/components/Proposal";
import { addNotices, finishedNotices, pageTitle, statusMap, unopenedReadyCount, type ReadyNotice } from "@/lib/readyNotice";
import { pickApi, realApi, type Api, type StateResponse } from "@/app/_client/api";
import type {
  AgentEvent,
  ArchiveDetail,
  ArchiveKind,
  ArchiveRow,
  BlogIdea,
  Candidate,
  DeclineReason,
  BoardDetail,
  BoardListItem,
  ModelChoice,
  NotebookCard,
  OutreachDraft,
  OutreachResult,
  PersonDetail as PersonDetailData,
  PersonRow,
  Proposal,
  SurveyVoice,
  UnassignedCard,
} from "@/app/_client/types";
import { AgentSteps, type LogItem } from "@/components/AgentSteps";
import { AcceptedView, Approved } from "@/components/Approved";
import { ArchiveList, ArchiveView } from "@/components/Archive";
import { CardDetail } from "@/components/CardDetail";
import { Header, type Tab } from "@/components/Header";
import { Inbox } from "@/components/Inbox";
import { usd } from "@/components/labels";
import { People, type NbLogLine } from "@/components/People";
import { PersonDetail } from "@/components/PersonDetail";
import { SurveyVoices } from "@/components/SurveyVoices";
import { UnassignedCards } from "@/components/UnassignedCards";
import { Spinner } from "@/components/ui";
import { AlternativePitch, Candidates } from "@/components/Proposal";
import { RequestInput, type RequestMode } from "@/components/RequestInput";
import { TraceTimeline } from "@/components/TraceTimeline";
import { FeedbackProvider, type FeedbackInput, type ReasonCodes } from "@/app/_client/feedback";

const msg = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

export default function Home() {
  const [api, setApi] = useState<Api>(realApi);
  const [debug, setDebug] = useState(false);
  const [tab, setTabState] = useState<Tab>("inbox");
  /** いまのタブ（非同期の処理が終わったときに、その間にタブを切り替えたかを見るため） */
  const tabRef = useRef<Tab>("inbox");
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);

  // people（ネタ帳タブ）
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [personId, setPersonId] = useState<string | null>(null);
  const [person, setPerson] = useState<PersonDetailData | null>(null);

  // archive
  const [archiveRows, setArchiveRows] = useState<ArchiveRow[]>([]);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [archiveKey, setArchiveKey] = useState<string | null>(null);
  const [archiveDetail, setArchiveDetail] = useState<ArchiveDetail | null>(null);

  // アンケートの声（ネタ帳タブ）
  const [voices, setVoices] = useState<SurveyVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const [voicesOpen, setVoicesOpen] = useState(false);

  // 担当者未定のネタ（ネタ帳タブ。リリースノートから作ったカード）
  const [unassigned, setUnassigned] = useState<UnassignedCard[]>([]);
  const [unassignedLoaded, setUnassignedLoaded] = useState(false);
  const [unassignedOpen, setUnassignedOpen] = useState(false);

  // notebook
  const [cards, setCards] = useState<NotebookCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 実行の記録の画面を開けるか（/api/state の trace_allowed。見せる用でも開ける） */
  const [traceAllowed, setTraceAllowed] = useState(false);
  /** 使われた結果を送る窓口（記録の側）があるか。?mock は手元に残すので常にある */
  const [feedbackReady, setFeedbackReady] = useState(false);
  /** 理由の選択肢（記録の側の REASON_CODES。/api/state から） */
  const [feedbackReasons, setFeedbackReasons] = useState<ReasonCodes | null>(null);
  /** 見せる用のときだけ：その人の残り（/api/state の share） */
  const [shareInfo, setShareInfo] = useState<StateResponse["share"]>(null);
  useEffect(() => {
    let alive = true;
    api.feedbackReady().then((ok) => alive && setFeedbackReady(ok));
    return () => {
      alive = false;
    };
  }, [api]);
  /** 同じ文の依頼を貼ったとき：新しく足さずに前の依頼を開いたことを知らせる */
  const [dupNotice, setDupNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [nbRunning, setNbRunning] = useState(false);
  const [nbLog, setNbLog] = useState<NbLogLine[]>([]);
  const [blog, setBlog] = useState<BlogIdea[] | null>(null);
  const [blogBusy, setBlogBusy] = useState(false);
  const [blogError, setBlogError] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; evidence: string | null } | null>(null);

  // request
  const [mode, setMode] = useState<RequestMode>("inbox");
  /** 承諾済みの依頼で「ほかの候補を見る」を開いたか */
  const [showOthers, setShowOthers] = useState(false);
  /** 声かけ中の人の返事を記録しに戻ってきた（声かけ文は作り直さない） */
  const [resume, setResume] = useState(false);
  const [customText, setCustomText] = useState("");
  const [customId, setCustomId] = useState("");
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [log, setLog] = useState<LogItem[]>([]);
  const [result, setResult] = useState<Proposal | null>(null);
  const [pitch, setPitch] = useState<string | null>(null);

  // inbox
  const [inboxItems, setInboxItems] = useState<BoardListItem[]>([]);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [inboxId, setInboxId] = useState<string | null>(null);
  const [inbox, setInbox] = useState<BoardDetail | null>(null);
  const [adding, setAdding] = useState(false);
  // 候補づくりが終わった依頼の知らせ（画面の端。どのタブにいても出す）と、前回の一覧の状態
  const [notices, setNotices] = useState<ReadyNotice[]>([]);
  const prevStatus = useRef<ReturnType<typeof statusMap> | null>(null);
  // 終わったあとの結果をまだ見ていない依頼（タブの題名の件数に数える）
  const [unseenDone, setUnseenDone] = useState<string[]>([]);

  // after approval
  const [approved, setApproved] = useState<Candidate | null>(null);
  const [approvedCardId, setApprovedCardId] = useState<string | null>(null);
  const [draft, setDraft] = useState<OutreachDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  /** いまの下書き（draft）がだれへのものか */
  const [draftOwner, setDraftOwner] = useState<string | null>(null);

  // cost
  const [runUsd, setRunUsd] = useState(0);
  const [totalUsd, setTotalUsd] = useState(0);
  const [models, setModels] = useState<ModelChoice | null>(null);
  const started = useRef(0);
  // ?mock かどうかが決まるまでは何も読まない（決まる前に本物の API を1回叩かないように）
  const [apiReady, setApiReady] = useState(false);

  useEffect(() => {
    setApi(pickApi());
    setApiReady(true);
    const q = new URLSearchParams(window.location.search);
    setDebug(q.has("debug"));
    const t = q.get("tab");
    // ?inbox={id} は受信箱の1件を開くリンクなので、受信箱タブにする
    if (!q.has("inbox") && (t === "notebook" || t === "archive")) setTabState(t);
  }, []);

  /** タブを切り替える（URL の ?tab= にも残す。受信箱は既定なので付けない） */
  function setTab(t: Tab) {
    tabRef.current = t; // 押した直後から分かるように（描き直しを待たない）
    setTabState(t);
    const url = new URL(window.location.href);
    if (t === "inbox") url.searchParams.delete("tab");
    else url.searchParams.set("tab", t);
    if (t !== "inbox") url.searchParams.delete("inbox");
    window.history.replaceState(null, "", url);
  }

  const loadCards = useCallback(async () => {
    try {
      const j = await api.cards();
      setCards(j.cards);
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
      setTraceAllowed(s.trace_allowed !== false);
      if (s.feedback_reasons) setFeedbackReasons(s.feedback_reasons);
      setShareInfo(s.share ?? null);
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

  const loadPeople = useCallback(async () => {
    try {
      setPeople(await api.people());
    } catch (err) {
      setLoadError(`人の一覧を読み込めませんでした（${msg(err, "不明なエラー")}）。ページを再読み込みしてください。`);
    } finally {
      setPeopleLoaded(true);
    }
  }, [api]);

  const loadArchive = useCallback(async () => {
    try {
      setArchiveRows(await api.archive());
    } catch {
      /* 一覧は前の内容のまま */
    } finally {
      setArchiveLoaded(true);
    }
  }, [api]);

  const loadVoices = useCallback(async () => {
    try {
      setVoices(await api.voices());
    } catch {
      /* 一覧は前の内容のまま */
    } finally {
      setVoicesLoaded(true);
    }
  }, [api]);

  const loadUnassigned = useCallback(async () => {
    try {
      setUnassigned(await api.unassigned());
    } catch {
      /* 一覧は前の内容のまま */
    } finally {
      setUnassignedLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    if (!apiReady) return;
    loadUnassigned();
    loadCards();
    loadState();
    loadInbox();
    loadPeople();
    loadArchive();
    loadVoices();
  }, [apiReady, api, loadCards, loadState, loadInbox, loadPeople, loadArchive, loadVoices, loadUnassigned]);

  // 代わりの人を推す文を作っているあいだ（pitch_status が pending）は、2秒ごとに詳細を読み直し、できたら出す
  useEffect(() => {
    if (mode !== "inbox" || !inboxId || inbox?.id !== inboxId || inbox.pitch_status !== "pending") return;
    const id = inboxId;
    const t = setInterval(async () => {
      try {
        const d = await api.inboxDetail(id);
        if (d.pitch_status === "pending") return;
        setInbox(d);
        if (d.result?.alternative_pitch) setPitch(d.result.alternative_pitch);
      } catch {
        /* 次の回にもう一度読む */
      }
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, inboxId, inbox?.id, inbox?.pitch_status, api]);

  // ?person={id}・?archive={kind}:{id} で開いたら、その人・その過去の依頼を開く（共有用のリンク）
  useEffect(() => {
    if (!apiReady) return;
    const q = new URLSearchParams(window.location.search);
    const pid = q.get("person");
    if (pid) void openPerson(pid);
    const [kind, aid] = (q.get("archive") ?? "").split(":");
    if ((kind === "inbox" || kind === "request" || kind === "event") && aid) void openArchive(kind, aid);
    // api が決まったときに1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiReady, api]);

  // アーカイブを開いたとき、何も選んでいなければアンケートのある一番新しいイベントを開く
  useEffect(() => {
    if (tab !== "archive" || archiveKey || !archiveLoaded) return;
    const first = archiveRows.find((r) => r.kind === "event" && (r.answers ?? 0) > 0) ?? archiveRows[0];
    if (first) void openArchive(first.kind, first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, archiveLoaded, archiveRows]);

  const units = useMemo(() => [...new Set(people.map((p) => p.business_unit))].sort(), [people]);
  const personCards = useMemo(() => (personId ? cards.filter((c) => c.employee_id === personId) : []), [cards, personId]);

  /** 狭い画面（一覧と詳細が縦に積まれるとき）は、選んだら詳細までスクロールする（何も起きないように見えないように） */
  function revealPanel() {
    if (typeof window === "undefined" || window.innerWidth > 860) return;
    requestAnimationFrame(() => document.querySelector(".panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function openPerson(id: string) {
    revealPanel();
    setVoicesOpen(false);
    setUnassignedOpen(false);
    setPersonId(id);
    try {
      setPerson(await api.person(id));
    } catch (err) {
      setPerson(null);
      setLoadError(`人の詳細を開けませんでした（${msg(err, "不明なエラー")}）。`);
    }
  }

  async function openArchive(kind: ArchiveKind, id: string) {
    revealPanel();
    setArchiveKey(`${kind}:${id}`);
    try {
      setArchiveDetail(await api.archiveDetail(kind, id));
    } catch {
      setArchiveDetail(null);
    }
  }

  // 受信箱は数秒ごとに見直す（Slackから届いた依頼や、準備が終わった依頼をすぐ出すため。サーバー内の読み込みだけでAPI代はかからない）
  useEffect(() => {
    if (!apiReady) return;
    // 準備中の依頼があるあいだは2秒ごと（進み具合を早めに出す）、なければ4秒ごと
    const preparing = inboxItems.some((x) => x.status === "processing");
    const t = setInterval(loadInbox, preparing ? 2000 : 4000);
    return () => clearInterval(t);
  }, [apiReady, loadInbox, inboxItems]);

  // 今、画面で見ている依頼（受信箱タブで開いているもの）。ほかのタブにいるときは、開いたままでも「見ていない」として扱う
  const viewingId = tab === "inbox" && mode === "inbox" ? inboxId : null;

  // 準備中だった依頼が終わったら、画面の端に知らせを出す（今見ている依頼は出さない。最初の読み込みでは出さない）
  useEffect(() => {
    if (!inboxLoaded) return;
    if (prevStatus.current) {
      const added = finishedNotices(prevStatus.current, inboxItems, viewingId);
      if (added.length) {
        setNotices((cur) => addNotices(cur, added));
        setUnseenDone((cur) => [...new Set([...cur, ...added.map((n) => n.id)])]);
      }
    }
    prevStatus.current = statusMap(inboxItems);
    // 一覧が変わったときだけ（見ている依頼が変わっただけでは出さない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxItems, inboxLoaded]);

  // 見ている依頼の知らせは消す（「開く」を押した・一覧から開いた・受信箱タブに戻った）
  useEffect(() => {
    if (!viewingId) return;
    setNotices((cur) => (cur.some((n) => n.id === viewingId) ? cur.filter((n) => n.id !== viewingId) : cur));
    setUnseenDone((cur) => (cur.includes(viewingId) ? cur.filter((id) => id !== viewingId) : cur));
  }, [viewingId]);

  // ブラウザのタブの題名に、まだ開いていない準備済みの件数を出す（「(1) ネタ帳Agent」。開いたら消える）
  useEffect(() => {
    document.title = pageTitle(unopenedReadyCount(inboxItems, viewingId, unseenDone));
  }, [inboxItems, viewingId, unseenDone]);

  // ?inbox={id} で開いたら、その依頼の候補画面を開く
  useEffect(() => {
    if (!apiReady) return;
    const id = new URLSearchParams(window.location.search).get("inbox");
    if (id) openInbox(id);
    // api が決まったときに1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiReady, api]);

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
        if (e.type === "done")
          // 新しい活動がなければ、数字を並べずにそう伝える（最初の「新しい活動はありません」の行と重ねない）
          setNbLog((l) =>
            e.created + e.updated + e.kept === 0
              ? [...l.filter((x) => x.text !== "新しい活動はありません"), { text: "新しい活動はありませんでした", tone: "info" }]
              : [...l, { text: `完了：新規${e.created}・更新${e.updated}・確認済み${e.kept}（${usd(e.run_usd)}）`, tone: "info" }],
          );
      });
    } catch (err) {
      setNbLog((l) => [...l, { text: `更新できませんでした（${msg(err, "不明なエラー")}）。もう一度押してください。`, tone: "error" }]);
    }
    setNbRunning(false);
    loadCards();
    loadState();
    loadPeople();
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
  const requestRef = () => (mode === "inbox" && inboxId ? { request_id: inboxId } : { request_id: customId, custom_text: customText });

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
    setShowOthers(false);
    setResume(false);
  }

  /** 「依頼ではなさそう」と読んだ1件を、人が依頼として進める（候補づくりは裏で続き、一覧の読み直しで出てくる） */
  async function proceedInbox(id: string) {
    try {
      await api.inboxProceed(id);
    } catch (err) {
      setLog((l) => [...l, { kind: "note", tone: "error", text: `進められませんでした（${msg(err, "不明なエラー")}）` }]);
    }
    await refreshInbox(id);
  }

  /** 依頼の状態だけを読み直す（結果を記録したあと。候補や作業ログはそのまま） */
  async function refreshInbox(id: string) {
    try {
      const d = await api.inboxDetail(id);
      setInbox(d);
    } catch {
      /* 状態が読めなくても画面はそのまま */
    }
    loadInbox();
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
    setDupNotice(null);
    revealPanel();
    setTabState("inbox");
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
      const { id, duplicate } = await api.inboxAdd(text);
      setCustomText("");
      await loadInbox();
      // 追加を待っている間にほかのタブへ移っていたら、受信箱に引き戻さない（追加した依頼は受信箱の一覧に入っている）
      if (tabRef.current !== "inbox") return;
      await openInbox(id);
      if (duplicate) setDupNotice("同じ依頼がもうあります。前に追加した依頼を開きました");
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
        // 考えた内容は出さない（「考えています」だけ。前に保存した作業ログに中身があっても出さない）
        setLog((l) => (l.at(-1)?.kind === "thinking" ? l : [...l, { kind: "thinking", text: "考えています" }]));
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
    const id = mode === "inbox" && inboxId ? inboxId : `custom-${Date.now().toString(36)}`;
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
    // サンプルの依頼は、出した候補がサーバーに保存されて「候補準備済み」になる
    if (mode === "inbox" && inboxId) void refreshInbox(inboxId);
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
      setDraftOwner(c.employee_id);
      if (j.fell_back) setDraftNote(`重いモデルが使えなかったため ${j.model} で作り直しました。`);
      setRunUsd(j.run_usd);
      setTotalUsd(j.total_usd);
    } catch (err) {
      setDraftError(`声かけ文を作れませんでした（${msg(err, "不明なエラー")}）。「もう一度作る」を押してください。`);
    } finally {
      setDrafting(false);
    }
  }

  /** その人のカード（承認したときに作ったカードも含む） */
  const cardOf = (c: Candidate) =>
    c.card_id ?? cards.find((x) => x.employee_id === c.employee_id && x.outreach_history.some((h) => h.request_id === result?.request_id))?.card_id ?? null;

  async function approve(c: Candidate) {
    if (!result) return;
    window.scrollTo({ top: 0, behavior: "smooth" });
    const isOutreach = inbox?.state.outreach_to.some((p) => p.employee_id === c.employee_id) ?? false;
    setResume(false);
    setDraftError(null);
    setApproved(c);
    setApprovedCardId(cardOf(c));
    // 前に作った下書き（声かけ文・構成案・主催者への返事）がサーバーに保存されていれば、それを出す。作り直さない
    const savedFor = mode === "inbox" ? inboxId : null;
    if (savedFor) {
      setDraft(null);
      setDraftNote(null);
      const saved = await api.savedDraft(savedFor, c.employee_id).catch(() => null);
      if (saved) {
        setDraft(saved);
        setDraftOwner(c.employee_id);
        return;
      }
    }
    // 声かけ中の人で、保存した下書きがないとき（前の版で作ったものなど）：返事を記録する画面だけを出す
    if (isOutreach) {
      setDraft(null);
      setResume(true);
      return;
    }
    // 下書きを作るだけ。まだ声はかけていないので、打診の記録は付けない（依頼は「下書き中」になる。lib/requestStage.ts）
    await makeDraft(c);
    if (inboxId) void refreshInbox(inboxId);
  }

  /** 声かけ文をコピーしたとき：ここで「承認」（声をかけた）を記録して、依頼を「声かけ中」にする。同じ人には1回だけ */
  const outreachSent = useRef(new Set<string>());
  async function markOutreach() {
    if (!approved || !result) return;
    const id = approved.employee_id;
    const key = `${result.request_id}:${id}`;
    if (outreachSent.current.has(key)) return;
    if (inbox?.state.outreach_to.some((p) => p.employee_id === id) || inbox?.state.accepted_by.some((p) => p.employee_id === id)) return;
    outreachSent.current.add(key);
    try {
      const card = await api.outcome({ ...requestRef(), request_id: result.request_id, card_id: approvedCardId ?? approved.card_id, result: "approved", candidate: candBody(approved) });
      setApprovedCardId(card.card_id);
      loadCards();
      loadPeople();
      if (inboxId) void refreshInbox(inboxId);
    } catch (err) {
      outreachSent.current.delete(key);
      setDraftError(`「声かけ中」を記録できませんでした（${msg(err, "不明なエラー")}）。コピーはできています。`);
    }
  }

  async function record(r: OutreachResult, reason?: DeclineReason) {
    if (!approved || !result) return;
    await api.outcome({
      ...requestRef(),
      request_id: result.request_id,
      card_id: approvedCardId ?? cardOf(approved),
      result: r,
      reason,
      candidate: candBody(approved),
    });
    loadCards();
    loadPeople();
    if (inboxId) await refreshInbox(inboxId);
    // 承諾：決まった人の画面へ。辞退：候補の一覧に戻って次の人を選ぶ
    if (r === "accepted" || r === "declined") {
      setApproved(null);
      setResume(false);
      setShowOthers(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const stage = mode === "inbox" ? inbox?.state.stage : undefined;
  /** 主催者への返事に入れてよい「空いていそうな日」の1文（日程が未定の依頼で、その人の日が見つかったときだけ） */
  const dateSentenceFor = (employeeId: string) =>
    mode === "inbox" ? inbox?.date_suggestions?.candidates.find((c) => c.employee_id === employeeId)?.reply_sentence ?? null : null;
  const marks: Record<string, CandidateMark> = {};
  for (const p of inbox?.state.declined_by ?? []) marks[p.employee_id] = "declined";
  for (const p of inbox?.state.drafting_for ?? []) marks[p.employee_id] = "drafting";
  for (const p of inbox?.state.outreach_to ?? []) marks[p.employee_id] = "outreach";
  for (const p of inbox?.state.accepted_by ?? []) marks[p.employee_id] = "accepted";
  // 承諾済みの人の主催者への返事：いま作った下書きがあればそれ、なければ保存した下書き
  const acceptedReply =
    inbox?.state.accepted_by
      .map((p) => (draft?.organizer_reply && approvedFor(p.employee_id) ? { name: p.name, text: draft.organizer_reply, employee_id: p.employee_id } : null))
      .find(Boolean) ?? inbox?.accepted_reply ?? null;
  function approvedFor(employeeId: string) {
    return draftOwner === employeeId;
  }

  // 使われた結果（この候補は違う・下書きを直して使った）を送る先の依頼。受信箱なら開いている1件、サンプルなら候補を出した依頼
  // 自由入力の依頼（custom）は記録の側に依頼がないので送らない
  const feedbackRequestId = mode === "inbox" ? inboxId : mode === "custom" ? null : result?.request_id ?? null;
  // 記録の側（POST /api/feedback）がまだないうちは、ボタンを出さない（requestId を渡さない）
  // 「違う」と記録済みの候補（依頼の詳細から。読み直しても残る）と、送ったあとの読み直し
  const wrongMarks = Object.fromEntries((mode === "inbox" ? inbox?.wrong_candidates ?? [] : []).map((w) => [w.employee_id, w.reason]));
  const feedbackCtx = {
    requestId: feedbackReady ? feedbackRequestId : null,
    reasons: feedbackReasons,
    send: (input: FeedbackInput) => api.feedback(input),
    wrong: wrongMarks,
    refresh: () => {
      if (mode === "inbox" && inboxId) void refreshInbox(inboxId);
    },
  };

  const requestPanel = (
    <FeedbackProvider value={feedbackCtx}>
    <div className="panel" aria-label="依頼パネル">
      {approved ? (
        <Approved
          candidate={approved}
          draft={draft}
          drafting={drafting}
          draftError={draftError}
          draftNote={draftNote}
          resume={resume}
          outreach={marks[approved.employee_id] === "outreach"}
          onOutreachCopied={() => void markOutreach()}
          dateSentence={dateSentenceFor(approved.employee_id)}
          onBack={() => {
            setApproved(null);
            setResume(false);
            setDraftError(null);
          }}
          onRetryDraft={() => {
            setResume(false);
            void makeDraft(approved);
          }}
          onRecord={record}
        />
      ) : (
        <>
          {dupNotice && (
            <p className="banner notice-warn" role="status">
              {dupNotice}
            </p>
          )}
          <RequestInput
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
            mock={api.mock}
            loading={mode === "inbox" && !!inboxId && !inbox}
            progress={mode === "inbox" ? inboxItems.find((x) => x.id === inboxId)?.progress ?? null : null}
            onProceed={mode === "inbox" && inboxId ? () => void proceedInbox(inboxId) : undefined}
          >
            {(log.length > 0 || running) && <AgentSteps log={log} running={running} seconds={seconds} result={result} />}
            {/* この依頼の記録（AI・ツールの呼び出しの時間の線）。見せる用でも出す */}
            {traceAllowed && feedbackRequestId && !running && (
              <TraceTimeline key={feedbackRequestId} api={api} requestId={feedbackRequestId} />
            )}
          </RequestInput>
          {stage === "accepted" && inbox && (
            <AcceptedView
              detail={inbox}
              reply={acceptedReply}
              onUndo={async (employeeId) => {
                const cardId = cards.find((c) => c.employee_id === employeeId && c.outreach_history.some((h) => h.request_id === inbox.id))?.card_id;
                if (!cardId) throw new Error("その人のカードが見つかりません");
                await api.undoOutcome(inbox.id, cardId);
                loadCards();
                loadPeople();
                await refreshInbox(inbox.id);
              }}
              showOthers={showOthers}
              onToggleOthers={() => setShowOthers((x) => !x)}
              onOpenCard={(employeeId) => {
                const id = cards.find((c) => c.employee_id === employeeId && c.outreach_history.some((h) => h.request_id === inbox.id))?.card_id;
                if (id) openCard(id);
              }}
            />
          )}
          {result && (stage !== "accepted" || showOthers) && (
            <Candidates
              result={result}
              disabled={drafting}
              onApprove={approve}
              onOpenCard={(id, ev) => openCard(id, ev ?? null)}
              marks={marks}
              dates={mode === "inbox" && stage !== "accepted" ? inbox?.date_suggestions ?? null : null}
              requestTitle={mode === "inbox" ? inbox?.title ?? null : null}
            />
          )}
          {result && pitch && (stage !== "accepted" || showOthers) && <AlternativePitch text={pitch} />}
          {result && !pitch && inbox?.pitch_status === "pending" && (stage !== "accepted" || showOthers) && (
            <section className="surface pad-lg" aria-live="polite">
              <Spinner label="代わりの人を推す文を作成中" />
            </section>
          )}
        </>
      )}
    </div>
    </FeedbackProvider>
  );

  return (
    <div className="app">
      <Header tab={tab} onTab={setTab} debug={debug} runUsd={runUsd} totalUsd={totalUsd} models={models} mock={api.mock} share={shareInfo} />
      {loadError && (
        <p className="banner banner-error" role="alert">
          {loadError}
        </p>
      )}
      <ReadyNotices notices={notices} onOpen={(id) => void openInbox(id)} onClose={(id) => setNotices((cur) => cur.filter((n) => n.id !== id))} />

      {tab === "inbox" && (
        <main className="main">
          <div className="side">
            <Inbox items={inboxItems} loaded={inboxLoaded} openId={mode === "inbox" ? inboxId : null} onOpen={(id) => void openInbox(id)} />
          </div>
          {requestPanel}
        </main>
      )}

      {tab === "notebook" && (
        <main className="main">
          <People
            people={people}
            units={units}
            loaded={peopleLoaded}
            openId={personId}
            onOpen={(id) => void openPerson(id)}
            cards={cards}
            pending={pending}
            updating={nbRunning}
            log={nbLog}
            onUpdate={updateNotebook}
            blog={blog}
            blogBusy={blogBusy}
            blogError={blogError}
            onBlog={blogIdeas}
            onCloseBlog={() => setBlog(null)}
            onOpenCard={(id) => openCard(id)}
            voiceCount={voices.length}
            voicesOpen={voicesOpen}
            onVoices={() => {
              setUnassignedOpen(false);
              setVoicesOpen((x) => !x);
            }}
            unassignedCount={unassigned.length}
            unassignedOpen={unassignedOpen}
            onUnassigned={() => {
              setVoicesOpen(false);
              setUnassignedOpen((x) => !x);
            }}
          />
          {unassignedOpen ? (
            <UnassignedCards
              cards={unassigned}
              loaded={unassignedLoaded}
              people={people}
              onAssign={async (cardId, employeeId) => {
                await api.assignUnassigned(cardId, employeeId);
                // その人のカードになり、一覧から消える
                await Promise.all([loadUnassigned(), loadCards(), loadPeople()]);
              }}
              onClose={() => setUnassignedOpen(false)}
            />
          ) : voicesOpen ? (
            <SurveyVoices
              voices={voices}
              loaded={voicesLoaded}
              onOpenCard={(id) => openCard(id)}
              onOpenPerson={(id) => void openPerson(id)}
              onClose={() => setVoicesOpen(false)}
            />
          ) : person && person.person.id === personId ? (
            <PersonDetail
              detail={person}
              cards={personCards}
              onOpenCard={(id) => openCard(id)}
              onSave={async (patch) => {
                await api.editPerson(person.person.id, patch);
                setPerson(await api.person(person.person.id));
                loadPeople();
              }}
            />
          ) : personId ? (
            // 選んだ人を読み込んでいる間（2〜3秒）。前の人のままだと押せていないように見えるので、読み込み中を出す
            <div className="panel" aria-busy="true">
              <section className="surface pad-lg">
                <Spinner label={`${people.find((x) => x.id === personId)?.name ?? ""}さんを読み込んでいます…`} />
              </section>
            </div>
          ) : (
            <div className="panel">
              <section className="surface pad-lg">
                <p className="meta">左から人を選ぶと、その人のネタ・ブログ・最近の活動が出ます。</p>
              </section>
            </div>
          )}
        </main>
      )}

      {tab === "archive" && (
        <main className="main">
          <ArchiveList rows={archiveRows} loaded={archiveLoaded} openKey={archiveKey} onOpen={(k, id) => void openArchive(k, id)} />
          <ArchiveView
            detail={archiveDetail && archiveKey === `${archiveDetail.kind}:${archiveDetail.id}` ? archiveDetail : null}
            loading={!!archiveKey && (!archiveDetail || archiveKey !== `${archiveDetail.kind}:${archiveDetail.id}`)}
            api={api}
            onChanged={() => {
              void loadCards();
              void loadArchive();
            }}
          />
        </main>
      )}

      {detailCard && (
        <CardDetail
          key={detailCard.card_id}
          card={detailCard}
          focusEvidence={detail?.evidence ?? null}
          requestTitle={(id) => inboxItems.find((x) => x.id === id)?.title ?? archiveRows.find((r) => r.id === id)?.title ?? null}
          surveyThemes={voices.map((v) => v.text)}
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
          onFindVenues={(cardId, onEvent) =>
            api.venues(cardId, (e) => {
              if (e.type === "usage" || e.type === "done") {
                setRunUsd(e.run_usd);
                setTotalUsd(e.total_usd);
              }
              onEvent(e);
            })
          }
          onVenueDraft={async (body) => {
            const j = await api.venueDraft(body);
            setTotalUsd(j.total_usd);
            return j;
          }}
        />
      )}
    </div>
  );
}
