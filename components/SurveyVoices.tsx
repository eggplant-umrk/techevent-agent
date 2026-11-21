"use client";

import type { SurveyVoice } from "@/app/_client/types";
import { Tag } from "./ui";

/**
 * ネタ帳タブの右：アンケートの声。参加者が「今後聞いてみたい話」を、イベント名・日付・件数つきで並べる。
 * 合う人（別の社員の未発信のネタと重なる＝需要あり）がいれば、その人とカードへのリンク。いなければ「まだ話せる人がいない」。
 * どの登壇への声かは出さない。
 */
export function SurveyVoices({
  voices,
  loaded,
  onOpenCard,
  onOpenPerson,
  onClose,
}: {
  voices: SurveyVoice[];
  loaded: boolean;
  onOpenCard: (cardId: string) => void;
  onOpenPerson: (employeeId: string) => void;
  onClose: () => void;
}) {
  const matched = voices.filter((v) => v.match).length;
  return (
    <div className="panel" aria-label="アンケートの声">
      <section className="surface cands" aria-labelledby="voices-title">
        <div className="cands-head">
          <div className="row-between">
            <h2 id="voices-title" className="h2">
              アンケートの声 <span className="meta">{voices.length}件・話せる人がいる声 {matched}件</span>
            </h2>
            <button type="button" className="link" onClick={onClose}>
              閉じる
            </button>
          </div>
          <p className="meta">イベント後のアンケートの「今後聞いてみたい話」です。分析したイベントの分だけ並びます。</p>
          {voices.some((v) => v.sample) && (
            <p className="small caveat">架空のアンケートの結果を含みます（保存済みの分析結果。「架空のアンケート」の印が付いた声）。</p>
          )}
        </div>
        {!loaded && <p className="meta pad">読み込んでいます…</p>}
        {loaded && voices.length === 0 && (
          <p className="meta pad">まだありません。アーカイブのイベントで「アンケートを分析する」と、ここに並びます。</p>
        )}
        <ul className="voice-list">
          {voices.map((v, i) => (
            <li key={`${v.event_id}-${i}`} className="cand">
              <p>
                <Tag tone="accent">アンケートの声</Tag> {v.sample && <Tag>架空のアンケート</Tag>} <span className="strong">{v.text}</span>
                <span className="meta">　{v.count}件</span>
              </p>
              <p className="meta">
                {v.event_date}「{v.event_title}」
              </p>
              {v.match ? (
                <p className="small">
                  話せそうな人：
                  <button type="button" className="link" onClick={() => onOpenPerson(v.match!.employee_id)}>
                    {v.match.name}さん
                  </button>
                  {"　"}
                  <button type="button" className="link" onClick={() => onOpenCard(v.match!.card_id)}>
                    カードを見る
                  </button>

                </p>
              ) : (
                <p className="small muted-strong">まだ話せる人がいない</p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
