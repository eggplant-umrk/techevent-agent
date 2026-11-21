"use client";

import type { BoardListItem, BoardSource, RequestStage } from "@/app/_client/types";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/requestStage";
import { md } from "./labels";
import { Tag } from "./ui";

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const sourceLabel = (s: BoardSource) => (s === "slack" ? "Slack" : s === "sample" ? "サンプル" : "手で追加");

/** 依頼の状態の印（準備中・候補準備済み・声かけ中・承諾済み・辞退）。状態はコードで決めたもの */
export function StageTag({ stage }: { stage: RequestStage }) {
  return <Tag tone={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Tag>;
}

/** 状態に合わせた1行（だれが受けたか・だれに声をかけているか） */
function stageLine(it: BoardListItem): string {
  const s = it.state;
  const names = (xs: Array<{ name: string }>) => xs.map((p) => `${p.name}さん`).join("・");
  if (s.stage === "accepted") return `${names(s.accepted_by)}が承諾`;
  if (s.stage === "outreach") return `${names(s.outreach_to)}に声かけ中（返事待ち）`;
  if (s.stage === "declined") return `${names(s.declined_by)}が辞退。次の人を選べます`;
  if (s.stage === "new") return "開いて「ネタ帳から候補を出す」を押すと、候補を準備します";
  if (s.stage === "preparing") return "Agentがネタ帳を探しています";
  if (s.stage === "error") return it.error ?? "候補を出せませんでした";
  return it.no_fit ? "合う候補は見つかりませんでした（理由を確認できます）" : `候補：${it.candidate_names.join("・")}`;
}

/** 受信箱：届いた依頼（Slack・手で追加・サンプル）と、今の状態が一目で分かる。押すとその依頼の画面が開く */
export function Inbox({
  items,
  loaded,
  openId,
  onOpen,
}: {
  items: BoardListItem[];
  loaded: boolean;
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const count = (st: RequestStage) => items.filter((x) => x.state.stage === st).length;
  const fresh = items.filter((x) => x.is_new).length;
  const summary = [
    fresh ? `新しい依頼 ${fresh}件` : "",
    count("outreach") ? `声かけ中 ${count("outreach")}件` : "",
    count("ready") ? `候補準備済み ${count("ready")}件` : "",
    count("preparing") ? `準備中 ${count("preparing")}件` : "",
  ]
    .filter(Boolean)
    .join("・");

  return (
    <section className="surface pad-lg inbox" aria-labelledby="inbox-title">
      <div className="row-between">
        <h2 id="inbox-title" className="h2">
          受信箱
        </h2>
        <p className="meta" aria-live="polite">
          {summary}
        </p>
      </div>

      {!loaded ? (
        <p className="meta">読み込んでいます…</p>
      ) : items.length === 0 ? (
        <p className="meta">まだ依頼はありません。Slackで届いた依頼や、右の「手で追加」から入れた依頼がここに並び、候補が自動で準備されます。</p>
      ) : (
        <ul className="inbox-list">
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" className="inbox-item" aria-current={it.id === openId ? "true" : undefined} onClick={() => onOpen(it.id)}>
                <span className="inbox-marks">
                  {it.is_new && <Tag tone="accent">新しい</Tag>}
                  <StageTag stage={it.state.stage} />
                  <span className="meta">
                    {sourceLabel(it.source)}・{when(it.received_at)}
                    {it.event_date ? `・開催 ${md(it.event_date)}` : ""}
                  </span>
                </span>
                <span className="strong inbox-title">{it.title}</span>
                <span className={`meta${it.state.stage === "accepted" ? " strong" : ""}`}>{stageLine(it)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
