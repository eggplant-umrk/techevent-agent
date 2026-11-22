"use client";

import type { BoardListItem, BoardSource, RequestStage } from "@/app/_client/types";
import { STAGE_LABEL, STAGE_TONE } from "@/lib/requestStage";
import { progressOf, progressText } from "@/lib/progressStage";
import { md } from "./labels";
import { Tag } from "./ui";
import { durationText, usdText } from "@/app/_client/feedback";

/** その依頼にかかった金額と時間（例：$0.81・2分18秒）。分からなければ出さない */
export function runCostText(it: Pick<BoardListItem, "run_usd" | "elapsed_ms">): string | null {
  const parts = [it.run_usd ? usdText(it.run_usd) : null, it.elapsed_ms ? durationText(it.elapsed_ms) : null].filter(Boolean);
  return parts.length ? parts.join("・") : null;
}

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const sourceLabel = (s: BoardSource) => (s === "slack" ? "Slack" : s === "sample" ? "サンプル" : "貼った会話");

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
  if (s.stage === "preparing") return progressText(it.progress ?? progressOf("reading"));
  if (s.stage === "error") return it.error ?? "候補を出せませんでした";
  // 依頼ではない・不適切と読んだもの（候補づくりは走らせていない）。「候補なし」と見分けられるように
  if (it.kind_label) return `${it.kind_label}${it.kind_reason ? `（${it.kind_reason}）` : ""}`;
  if (it.no_fit) return "合う候補は見つかりませんでした（理由を確認できます）";
  // 候補は2人まで出して「ほかN人」（名前が途中で切れないように）
  const shown = it.candidate_names.slice(0, 2).join("・");
  const more = it.candidate_names.length - 2;
  return `候補：${shown}${more > 0 ? `　ほか${more}人` : ""}`;
}

/** 一覧の見出し：準備中でイベント名がまだ読めていないときは、会話の1行目ではなく「新しい依頼（読み取り中）」 */
export const inboxTitle = (it: Pick<BoardListItem, "title" | "state">) => (it.state.stage === "preparing" ? "新しい依頼（読み取り中）" : it.title);

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
        <p className="meta">まだ依頼はありません。Slackで届いた依頼や、右上の「会話を貼って追加」から入れた依頼がここに並び、候補が自動で準備されます。</p>
      ) : (
        <ul className="inbox-list">
          {items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="inbox-item"
                aria-current={it.id === openId ? "true" : undefined}
                aria-label={`${inboxTitle(it)}（${STAGE_LABEL[it.state.stage]}）`}
                onClick={() => onOpen(it.id)}
              >
                <span className="inbox-marks">
                  {it.is_new && <Tag tone="accent">新しい</Tag>}
                  <StageTag stage={it.state.stage} />
                  <span className="meta">
                    {it.source !== "sample" && `${sourceLabel(it.source)}・`}
                    {when(it.received_at)}
                    {it.event_date ? `・開催 ${md(it.event_date)}` : ""}
                  </span>
                </span>
                <span className="strong inbox-title">{inboxTitle(it)}</span>
                <span className={`meta${it.state.stage === "accepted" ? " strong" : ""}`}>{stageLine(it)}</span>
                {runCostText(it) && (
                  <span className="meta run-cost" aria-label={`かかった金額と時間：${runCostText(it)}`}>
                    {runCostText(it)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
