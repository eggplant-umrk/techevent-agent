"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, CandidateCard, ProposalResult } from "@/lib/agent";
import type { DeclineReason, Learning, SpeakingRequest } from "@/lib/data";
import type { OutreachDraft } from "@/lib/heavy";
import type { ModelChoice } from "@/lib/usage";

const PATTERN_LABEL: Record<string, string> = {
  open_slot: "枠だけ",
  theme_specified: "テーマ指定",
  named_speaker: "指名",
};

const TOOL_LABEL: Record<string, string> = {
  read_learnings: "過去の学びを読む",
  search_activities: "取り組みを検索",
  list_employees: "社員を絞り込む",
  get_employee: "社員の詳細",
  get_speaking_history: "登壇履歴",
  check_schedule: "予定の確認",
  get_published: "発信済みの確認",
  submit_candidates: "候補を提出",
};

const REASON_LABEL: Record<DeclineReason, string> = {
  theme_mismatch: "テーマが合わない",
  busy: "忙しい",
  schedule_conflict: "予定が重なる",
  other: "その他",
};

const ACTIVITY_LABEL: Record<string, string> = {
  slack_post: "Slack",
  github_pr: "PR",
  design_doc: "設計ドキュメント",
  weekly_report: "週報",
};

type LogItem =
  | { kind: "step"; n: number; max: number }
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; summary?: string; ok?: boolean }
  | { kind: "note"; text: string; tone: "info" | "warn" | "error" };

type Learn = Learning & { employee_name: string };

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`;

function inputPreview(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "search_activities") return `「${i.query}」${i.since ? ` ${i.since}以降` : ""}`;
  if (name === "check_schedule") return `${i.id} ${i.date}`;
  if (name === "get_published") return String(i.author_id ?? "");
  if (name === "list_employees") return Object.entries(i).map(([k, v]) => `${k}=${v}`).join(" ");
  if (name === "submit_candidates") return "";
  if ("id" in i) return String(i.id);
  return "";
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

export default function Home() {
  const [presets, setPresets] = useState<SpeakingRequest[]>([]);
  const [selected, setSelected] = useState<string>("req001");
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [customText, setCustomText] = useState("");
  const [customId, setCustomId] = useState("");

  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogItem[]>([]);
  const [result, setResult] = useState<ProposalResult | null>(null);
  const [pitch, setPitch] = useState<string | null>(null);
  const [runUsd, setRunUsd] = useState(0);
  const [totalUsd, setTotalUsd] = useState(0);
  const [models, setModels] = useState<ModelChoice | null>(null);
  const [runModels, setRunModels] = useState<{ loop: string; heavy: string } | null>(null);

  const [approved, setApproved] = useState<CandidateCard | null>(null);
  const [draft, setDraft] = useState<OutreachDraft | null>(null);
  const [draftMeta, setDraftMeta] = useState<{ model: string; fell_back: boolean } | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<"accepted" | "declined">("accepted");
  const [reason, setReason] = useState<DeclineReason>("busy");
  const [note, setNote] = useState("");
  const [recorded, setRecorded] = useState(false);

  const [learns, setLearns] = useState<Learn[]>([]);
  const logEnd = useRef<HTMLDivElement>(null);

  const refreshState = useCallback(async () => {
    const s = (await fetch("/api/state").then((r) => r.json())) as { models: ModelChoice; learnings: Learn[] };
    setModels(s.models);
    setTotalUsd(s.models.totalUsd);
    setLearns(s.learnings);
  }, []);

  useEffect(() => {
    fetch("/api/requests")
      .then((r) => r.json())
      .then(setPresets);
    refreshState();
  }, [refreshState]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [log]);

  const current = presets.find((p) => p.id === selected);
  const requestRef = () =>
    mode === "preset" ? { request_id: selected } : { request_id: customId, custom_text: customText };
  const shownModels = runModels ?? (models ? { loop: models.loop, heavy: models.heavy } : null);

  async function run() {
    const id = mode === "custom" ? `custom-${Date.now().toString(36)}` : selected;
    if (mode === "custom") setCustomId(id);
    setRunning(true);
    setLog([]);
    setResult(null);
    setPitch(null);
    setApproved(null);
    setDraft(null);
    setDraftError(null);
    setRecorded(false);
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
    const reader = res.body.getReader();
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
        if (line) handle(JSON.parse(line) as AgentEvent);
      }
    }
    setRunning(false);
    refreshState();
  }

  function handle(e: AgentEvent) {
    switch (e.type) {
      case "start":
        setRunModels({ loop: e.loop_model, heavy: e.heavy_model });
        if (e.switched)
          setLog((l) => [
            ...l,
            { kind: "note", tone: "warn", text: `累計が$${e.switch_usd}を超えたため、ループを ${e.loop_model}、重い仕事を ${e.heavy_model} に切り替えています` },
          ]);
        break;
      case "step":
        setLog((l) => [...l, { kind: "step", n: e.n, max: e.max }]);
        break;
      case "thinking":
        setLog((l) => [...l, { kind: "thinking", text: e.text }]);
        break;
      case "text":
        setLog((l) => [...l, { kind: "text", text: e.text }]);
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
        setLog((l) => [...l, { kind: "note", tone: "info", text: `完了：モデル呼び出し${e.steps}回／今回 ${usd(e.run_usd)}` }]);
        break;
    }
  }

  async function approve(c: CandidateCard) {
    if (!result) return;
    setApproved(c);
    setDraft(null);
    setDraftError(null);
    setRecorded(false);
    setDrafting(true);
    const res = await fetch("/api/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestRef(),
        run_id: result.run_id,
        candidate: {
          employee_id: c.employee_id,
          theme: c.theme,
          reason: c.reason,
          evidence_activity_ids: c.evidence.map((x) => x.id),
        },
      }),
    });
    const j = await res.json();
    setDrafting(false);
    if (!res.ok) {
      setDraftError(j.error ?? "下書きを作れませんでした");
      return;
    }
    setDraft(j.draft);
    setDraftMeta({ model: j.model, fell_back: j.fell_back });
    setRunUsd(j.run_usd);
    setTotalUsd(j.total_usd);
  }

  async function record() {
    if (!approved || !result) return;
    const res = await fetch("/api/outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestRef(),
        request_id: result.request_id,
        employee_id: approved.employee_id,
        result: outcome,
        reason: outcome === "declined" ? reason : undefined,
        note,
        theme: approved.theme,
      }),
    });
    if (res.ok) {
      setRecorded(true);
      setNote("");
      refreshState();
    }
  }

  const draftText = draft
    ? `${draft.subject}\n\n${draft.message}\n\n【構成案】\n${draft.lt_outline
        .map((s) => `${s.minutes}分　${s.heading}\n${s.points.map((p) => `・${p}`).join("\n")}`)
        .join("\n")}`
    : "";

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1>登壇マッチングAgent</h1>
          <p className="sub">登壇依頼に対して、まだ登壇していない人も含めて「人×テーマ」の候補を出します。送信はしません。</p>
        </div>
        <div className="meter">
          <div>
            <span className="meter-label">今回の提案</span>
            <span className="meter-value">{usd(runUsd)}</span>
          </div>
          <div>
            <span className="meter-label">累計</span>
            <span className="meter-value">{usd(totalUsd)}</span>
          </div>
          {shownModels && (
            <div className="meter-models">
              ループ: {shownModels.loop}
              <br />
              重い仕事: {shownModels.heavy}
            </div>
          )}
        </div>
      </header>
      {models?.switched && (
        <div className="banner warn">
          累計が ${models.switchUsd} を超えたため、安いモデルに自動で切り替えています（ループ {models.loop}／重い仕事 {models.heavy}）
        </div>
      )}

      {/* 1. 依頼入力 */}
      <section className="panel">
        <h2>
          <span className="num">1</span>依頼
        </h2>
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
                  <b>{current.requester?.organization}</b>（{current.requester?.contact_name}）
                </div>
                <div className="muted">
                  {current.event?.audience}／{current.event?.venue}／回答期限 {current.reply_deadline}
                </div>
                {current.theme && <div>テーマ：{current.theme}</div>}
                <blockquote>{current.message}</blockquote>
              </div>
            )}
          </>
        ) : (
          <textarea
            className="input"
            rows={5}
            placeholder="例：来月のLT会でLayerXさんの枠を1つ用意しています。テーマはお任せします。"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
          />
        )}
        <button className="btn primary" disabled={running || (mode === "custom" && !customText.trim())} onClick={run}>
          {running ? "Agentが作業中…" : "Agentに候補を探してもらう"}
        </button>
      </section>

      {/* 2. 作業ログ */}
      {(log.length > 0 || running) && (
        <section className="panel">
          <h2>
            <span className="num">2</span>Agentの作業ログ
          </h2>
          <div className="log">
            {log.map((item, i) => {
              if (item.kind === "step")
                return (
                  <div key={i} className="log-step">
                    ステップ {item.n}/{item.max}
                  </div>
                );
              if (item.kind === "thinking")
                return (
                  <div key={i} className="log-thinking">
                    {item.text}
                  </div>
                );
              if (item.kind === "text")
                return (
                  <div key={i} className="log-text">
                    {item.text}
                  </div>
                );
              if (item.kind === "note")
                return (
                  <div key={i} className={`log-note ${item.tone}`}>
                    {item.text}
                  </div>
                );
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
        </section>
      )}

      {/* 3. 候補カード */}
      {result && (
        <section className="panel">
          <h2>
            <span className="num">3</span>候補（{PATTERN_LABEL[result.request_pattern]}）
          </h2>
          <p>{result.summary}</p>
          {result.nominee_assessment && (
            <div className="assess">
              <b>指名された人の確認</b>
              <p>{result.nominee_assessment}</p>
            </div>
          )}
          {result.learnings_applied.length > 0 && (
            <div className="applied">
              <b>過去の学びから反映したこと</b>
              <ul>
                {result.learnings_applied.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="cards">
            {result.candidates.map((c) => (
              <article key={c.employee_id} className={approved?.employee_id === c.employee_id ? "card on" : "card"}>
                <div className="card-head">
                  <span className="rank">{c.rank}</span>
                  <div>
                    <div className="name">{c.name}</div>
                    <div className="muted">
                      {c.business_unit}／{c.role}
                    </div>
                  </div>
                </div>
                <div className="badges">
                  {c.is_alternative_to_nominee && <span className="chip accent">代わりの提案</span>}
                  <span className="chip">登壇{c.past_talk_count}回</span>
                  <span className="chip">忙しさ{c.workload}</span>
                </div>
                <div className="theme">{c.theme}</div>
                <p className="reason">{c.reason}</p>
                <div className="evidence">
                  <div className="label">根拠の投稿</div>
                  <ul>
                    {c.evidence.map((ev) => (
                      <li key={ev.id}>
                        <span className="chip small">{ACTIVITY_LABEL[ev.type] ?? ev.type}</span> {ev.title}
                        <span className="muted">（{ev.date}）</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {c.cautions.length > 0 && (
                  <div className="cautions">
                    <div className="label">注意点</div>
                    <ul>
                      {c.cautions.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <button className="btn primary" disabled={drafting} onClick={() => approve(c)}>
                  {approved?.employee_id === c.employee_id ? "承認済み" : "この人で承認する"}
                </button>
              </article>
            ))}
          </div>
          {pitch && (
            <div className="assess">
              <b>代わりの人を推す理由（依頼元・本人への相談用）</b>
              <p className="pre">{pitch}</p>
              <Copy text={pitch} />
            </div>
          )}
        </section>
      )}

      {/* 4. 下書き */}
      {approved && (
        <section className="panel">
          <h2>
            <span className="num">4</span>声かけ文とLT構成案（下書き）
          </h2>
          <p className="muted">送信はしません。内容を確認して、ご自身で送ってください。</p>
          {drafting && <div className="log-note info pulse">{approved.name}さんへの下書きを作っています…</div>}
          {draftError && <div className="log-note error">{draftError}</div>}
          {draft && (
            <>
              {draftMeta?.fell_back && <div className="log-note warn">重いモデルが使えなかったため {draftMeta.model} で作り直しました</div>}
              <div className="draft">
                <div className="draft-subject">{draft.subject}</div>
                <p className="pre">{draft.message}</p>
                <Copy text={`${draft.subject}\n\n${draft.message}`} label="声かけ文をコピー" />
              </div>
              <div className="outline">
                {draft.lt_outline.map((s, i) => (
                  <div key={i} className="outline-row">
                    <span className="mins">{s.minutes}分</span>
                    <div>
                      <b>{s.heading}</b>
                      <ul>
                        {s.points.map((p, j) => (
                          <li key={j}>{p}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
                <div>
                  <Copy text={draftText} label="全部コピー" />
                </div>
              </div>
              {draft.tips_for_pr.length > 0 && (
                <div className="applied">
                  <b>声をかける前に</b>
                  <ul>
                    {draft.tips_for_pr.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* 5. 結果の記録 */}
      {approved && draft && (
        <section className="panel">
          <h2>
            <span className="num">5</span>結果の記録
          </h2>
          <div className="row">
            <label className="radio">
              <input type="radio" checked={outcome === "accepted"} onChange={() => setOutcome("accepted")} /> 承諾
            </label>
            <label className="radio">
              <input type="radio" checked={outcome === "declined"} onChange={() => setOutcome("declined")} /> 辞退
            </label>
            {outcome === "declined" && (
              <select className="input" value={reason} onChange={(e) => setReason(e.target.value as DeclineReason)}>
                {Object.entries(REASON_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </div>
          <input
            className="input"
            placeholder="メモ（例：12月はリリースで手が離せない）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn primary" onClick={record} disabled={recorded}>
            {recorded ? "記録しました" : `${approved.name}さんの結果を記録する`}
          </button>
        </section>
      )}

      {/* 6. Agentの学び */}
      <section className="panel">
        <h2>
          <span className="num">6</span>Agentの学び
        </h2>
        <p className="muted">記録した結果は、次の提案の最初にAgentが読み込みます。</p>
        {learns.length === 0 ? (
          <p className="muted">まだ記録はありません。</p>
        ) : (
          <ul className="learns">
            {learns.map((l, i) => (
              <li key={i}>
                <span className={l.result === "accepted" ? "chip ok" : "chip warn"}>
                  {l.result === "accepted" ? "承諾" : `辞退：${REASON_LABEL[l.reason ?? "other"]}`}
                </span>
                <b>{l.employee_name}</b>
                {l.theme && <span>「{l.theme}」</span>}
                {l.event_date && <span className="muted">（開催 {l.event_date}）</span>}
                {l.note && <span className="muted">— {l.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
