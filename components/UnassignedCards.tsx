"use client";

import { useState } from "react";
import type { PersonRow, UnassignedCard } from "@/app/_client/types";
import { ACTIVITY_LABEL, FORMAT_LABEL } from "./labels";
import { ErrorLine, Tag } from "./ui";

/**
 * ネタ帳タブの右：担当者未定のネタ（リリースノートから作った、担当者が決まっていないカード）。
 * 各行にリリースのタイトル・日付・公開ページへのリンク・テーマ案。担当者を選んで割り当てると、その人のカードになり一覧から消える。
 */
export function UnassignedCards({
  cards,
  loaded,
  people,
  onAssign,
  onClose,
}: {
  cards: UnassignedCard[];
  loaded: boolean;
  people: PersonRow[];
  onAssign: (cardId: string, employeeId: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="panel" aria-label="担当者未定のネタ">
      <section className="surface cands" aria-labelledby="unassigned-title">
        <div className="cands-head">
          <div className="row-between">
            <h2 id="unassigned-title" className="h2">
              担当者未定のネタ <span className="meta">{cards.length}件</span>
            </h2>
            <button type="button" className="link" onClick={onClose}>
              閉じる
            </button>
          </div>
          <p className="meta">リリースノートから作ったネタのうち、だれの取り組みか決まっていないものです。担当者を選ぶと、その人のネタになります。</p>
        </div>
        {!loaded && <p className="meta pad">読み込んでいます…</p>}
        {loaded && cards.length === 0 && <p className="meta pad">担当者未定のネタはありません。</p>}
        {cards.map((c) => (
          <Row key={c.card_id} card={c} people={people} onAssign={onAssign} />
        ))}
      </section>
    </div>
  );
}

function Row({ card, people, onAssign }: { card: UnassignedCard; people: PersonRow[]; onAssign: (cardId: string, employeeId: string) => Promise<void> }) {
  // 関わっていそうな人：キーワードが一致した活動（根拠）がある人だけを先に並べる。最初から誰も選ばない（推測で選んでおかない）
  const related = new Set(card.related_employees.map((p) => p.id));
  // 並び：根拠のある人 → リリースのプロダクトと同じ事業部の人（例：「バクラク契約管理」ならバクラク）→ ほか
  const product = card.release_notes.map((n) => n.product).join(" ");
  const sameUnit = (p: PersonRow) => !!p.business_unit && product.includes(p.business_unit);
  const rank = (p: PersonRow) => (related.has(p.id) ? 0 : sameUnit(p) ? 1 : 2);
  const sorted = [...people].sort((a, b) => rank(a) - rank(b));
  const [who, setWho] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
      await onAssign(card.card_id, who);
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "割り当てられませんでした"}。もう一度押してください。`);
      setBusy(false);
    }
  }

  return (
    <article className="cand" aria-label={card.release_notes[0]?.title ?? card.card_id}>
      {card.release_notes.map((n) => (
        <p key={n.id}>
          <Tag tone="accent">リリース</Tag>{" "}
          {n.url ? (
            <a href={n.url} target="_blank" rel="noreferrer" className="strong" title="公開ページを新しいタブで開きます">
              {n.title}
              <span aria-hidden="true"> ↗</span>
            </a>
          ) : (
            <span className="strong">{n.title}</span>
          )}
          <span className="meta">
            　{n.date}
            {n.product ? `・${n.product}` : ""}
            {n.team ? `・${n.team}` : ""}
          </span>
        </p>
      ))}
      <h3 className="h4">テーマ案</h3>
      <ul className="plain-list small">
        {card.themes.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p className="meta">おすすめの形：{FORMAT_LABEL[card.format] ?? card.format}</p>
      {card.related_employees.length > 0 ? (
        <div className="small">
          <h3 className="h4">関わっていそうな人（キーワードが一致した活動）</h3>
          <ul className="plain-list">
            {card.related_employees.map((p) => (
              <li key={p.id}>
                <span className="strong">{p.name}さん</span>
                <span className="meta">
                  　根拠：
                  {p.evidence.map((e) => `${ACTIVITY_LABEL[e.type] ?? e.type} ${e.date}「${e.title}」`).join("／")}
                  {p.matched_keywords.length > 0 && `（一致：${p.matched_keywords.join("・")}）`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="meta">キーワードが一致する活動のある人は見つかりませんでした。担当者を選んでください。</p>
      )}
      <div className="btn-row">
        <select className="input input-sm" aria-label="担当者" value={who} onChange={(e) => setWho(e.target.value)} disabled={busy}>
          <option value="">担当者を選ぶ</option>
          {sorted.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}（{p.business_unit}）{related.has(p.id) ? "・関わっていそう" : sameUnit(p) ? "・同じ事業部" : ""}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-primary btn-sm" disabled={!who || busy} onClick={assign}>
          {busy ? "割り当てています…" : "この人に割り当てる"}
        </button>
      </div>
      <ErrorLine message={error} />
    </article>
  );
}
