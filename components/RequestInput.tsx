"use client";

import type { BoardDetail, IntakeField } from "@/app/_client/types";
import { md } from "./labels";
import { StageTag, sourceLabel } from "./Inbox";
import { Tag } from "./ui";

/** inbox：受信箱から開いた依頼／custom：手で追加（受信箱に入る）。サンプルの依頼も受信箱に並ぶ（入口は受信箱だけ） */
export type RequestMode = "custom" | "inbox";

const INTAKE_ROWS: Array<[IntakeField, string]> = [
  ["event_name", "イベント名"],
  ["date", "日程"],
  ["format", "形式"],
  ["theme", "テーマ"],
  ["organizer", "主催者"],
];

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function RequestInput({
  mode,
  onMode,
  customText,
  onCustomText,
  running,
  onRun,
  inbox,
  adding,
  onAdd,
  compact,
  mock = false,
  children,
}: {
  mode: RequestMode;
  onMode: (m: RequestMode) => void;
  customText: string;
  onCustomText: (t: string) => void;
  running: boolean;
  onRun: () => void;
  /** 受信箱から開いた依頼（mode === "inbox" のとき） */
  inbox: BoardDetail | null;
  adding: boolean;
  /** 手で追加：受信箱に入れて、候補づくりを始める */
  onAdd: () => void;
  /** 候補を出したあとは、依頼文をたたんで要約だけにする */
  compact: boolean;
  /** ?mock のとき：保存済みの結果を出していることを明記する */
  mock?: boolean;
  /** The agent's steps, shown under the request without another frame. */
  children?: React.ReactNode;
}) {
  const preparing = mode === "inbox" && inbox?.status === "processing";
  const st = inbox?.state;

  return (
    <section className="surface pad-lg req" aria-labelledby="req-title">
      <div className="row-between">
        <h2 id="req-title" className="h2">
          依頼
        </h2>
        {mode !== "custom" && (
          <button type="button" className="btn btn-sm" onClick={() => onMode("custom")}>
            会話を貼って追加
          </button>
        )}
      </div>

      {mode === "inbox" && !inbox && (
        <p className="meta">左の受信箱から依頼を選んでください。X の DM・リプライなどで届いた依頼は、右上の「会話を貼って追加」から会話をそのまま貼って入れられます。</p>
      )}
      {mock && (
        <p className="small caveat" role="note">
          モックでは保存済みの結果を出しています（貼った会話の中身は読まず、決まった例を出します）。
        </p>
      )}

      {mode === "inbox" && inbox && (
        <div className="req-summary">
          <p className="meta inbox-marks">
            {st && <StageTag stage={st.stage} />}
            <span>
              受信箱・{sourceLabel(inbox.source)}・{when(inbox.received_at)}
              {inbox.event_date ? `・開催 ${md(inbox.event_date)}` : ""}
            </span>
            {inbox.permalink && (
              <a href={inbox.permalink} target="_blank" rel="noreferrer">
                Slackで開く
              </a>
            )}
          </p>
          <h3 className="req-title">{inbox.title}</h3>
          {st && st.accepted_by.length > 0 && <p className="small strong">{st.accepted_by.map((p) => `${p.name}さん`).join("・")}が承諾</p>}
          {st && st.stage === "outreach" && <p className="small muted-strong">{st.outreach_to.map((p) => `${p.name}さん`).join("・")}に声かけ中（返事待ち）</p>}
          {st && st.stage === "declined" && <p className="small muted-strong">{st.declined_by.map((p) => `${p.name}さん`).join("・")}が辞退。次の人を選べます</p>}
          {inbox.nominee_name && <p className="small muted-strong">指名：{inbox.nominee_name}さん（依頼文から読み取り）</p>}
          {inbox.event_urls?.length > 0 && (
            <p className="small">
              イベントページ：
              {inbox.event_urls.map((u, i) => (
                <span key={u}>
                  {i > 0 && "、"}
                  <a href={u} target="_blank" rel="noreferrer">
                    {u}
                  </a>
                </span>
              ))}
              <span className="meta">（依頼文から読み取り）</span>
            </p>
          )}
          {inbox.intake && (
            <dl className="person-facts intake" aria-label="会話から読み取った項目">
              {INTAKE_ROWS.map(([f, label]) => (
                <div key={f} className="intake-row">
                  <dt>{label}</dt>
                  <dd>{inbox.intake![f] ?? <Tag tone="warn">未定</Tag>}</dd>
                </div>
              ))}
            </dl>
          )}
          <details className="req-message" open={!compact}>
            <summary>依頼文を読む</summary>
            <p className="pre small">{inbox.text}</p>
          </details>
          {inbox.status === "error" && <p className="error-line" role="alert">{inbox.error ?? "候補を出せませんでした"}。「もう一度探す」を押してください。</p>}
        </div>
      )}

      {mode === "custom" && (
        <label className="field">
          <span className="field-label">
            X の DM・リプライなどの会話を、そのまま貼ってください。イベント名・日程・形式・テーマ・指名・主催者を読み取り、受信箱に入れて候補を準備します（読み取れない項目は「未定」）
          </span>
          <textarea
            className="input"
            rows={8}
            placeholder={[
              "例：",
              "@organizer",
              "来月のLT会でLayerXさんの枠を1つ用意しています！",
              "@layerx_techpr",
              "ありがとうございます、日程は決まっていますか？",
              "@organizer",
              "1/29（金）19時〜です。テーマはお任せします",
            ].join("\n")}
            value={customText}
            onChange={(e) => onCustomText(e.target.value)}
          />
        </label>
      )}

      <div className="btn-row">
        {mode === "custom" ? (
          <>
            <button type="button" className="btn btn-primary" disabled={adding || !customText.trim()} onClick={onAdd}>
              {adding ? "受信箱に追加しています…" : "受信箱に追加"}
            </button>
            <button type="button" className="btn" disabled={adding} onClick={() => onMode("inbox")}>
              やめる
            </button>
          </>
        ) : (
          inbox &&
          st?.stage !== "accepted" && (
            <button type="button" className={`btn ${st?.stage === "new" ? "btn-primary" : ""}`} disabled={running || preparing} onClick={onRun}>
              {preparing ? "候補を準備しています…" : running ? "ネタ帳を探しています…" : st?.stage === "new" ? "ネタ帳から候補を出す" : "もう一度探す"}
            </button>
          )
        )}
      </div>
      {children}
    </section>
  );
}
