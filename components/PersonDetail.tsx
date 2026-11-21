"use client";

import { useEffect, useState } from "react";
import type { NotebookCard, PersonDetail as Detail, PersonPatch, SpeakingIntent } from "@/app/_client/types";
import { ACTIVITY_LABEL, md } from "./labels";
import { acceptedRequestIds } from "@/lib/requestStage";
import { CardMarks, ErrorLine, Tag } from "./ui";
import { RecentBlogs } from "./RecentBlogs";

const INTENT: Array<[SpeakingIntent, string]> = [
  ["available", "今は受けられる"],
  ["hold", "今は控えたい"],
  ["unknown", "未確認"],
];
const intentLabel = (i: SpeakingIntent) => INTENT.find(([k]) => k === i)?.[1] ?? "未確認";
const FIELD: Record<string, string> ={ expertise_tags: "得意分野", speaking_intent: "登壇の意向", ng_themes: "NGのテーマ" };

/**
 * ネタ帳タブの右：人の詳細。
 * 人の情報（直せる）→ その人のカード → 最近の活動。予定はネタ帳タブには出さない（忙しさの計算は候補と出し先の注意点で使う）。
 * カードのない人は「最近の活動」だけを出す。
 */
export function PersonDetail({
  detail,
  cards,
  onSave,
  onOpenCard,
}: {
  detail: Detail;
  /** その人のカード（ネタ帳のカードそのもの。開くと既存のカード詳細） */
  cards: NotebookCard[];
  onSave: (patch: PersonPatch) => Promise<void>;
  onOpenCard: (cardId: string) => void;
}) {
  const p = detail.person;
  const [editing, setEditing] = useState(false);
  const [tags, setTags] = useState(p.expertise_tags.join("、"));
  const [intent, setIntent] = useState<SpeakingIntent>(p.speaking_intent);
  const [ng, setNg] = useState(p.ng_themes.join("、"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEditing(false);
    setError(null);
    setTags(p.expertise_tags.join("、"));
    setIntent(p.speaking_intent);
    setNg(p.ng_themes.join("、"));
  }, [p]);

  const split = (s: string) => s.split(/[、,\n]/).map((x) => x.trim()).filter(Boolean);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await onSave({ expertise_tags: split(tags), speaking_intent: intent, ng_themes: split(ng) });
      setEditing(false);
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "保存できませんでした"}。内容を確かめて、もう一度押してください。`);
    }
    setBusy(false);
  }


  return (
    <div className="panel" aria-label="人の詳細">
      <section className="surface pad-lg" aria-labelledby="pd-name">
        <div className="row-between">
          <h2 id="pd-name" className="h2">
            {p.name}
          </h2>
          <span className="tags">
            {p.reviewed && <Tag tone="ok">確認済み</Tag>}
          </span>
        </div>
        <p className="meta">
          {p.business_unit}・{p.role}・{detail.talk_tag}・登壇{p.past_talk_count}回{p.last_talk_date ? `（最終 ${p.last_talk_date}）` : ""}
        </p>

        {!editing ? (
          <dl className="person-facts">
            <dt>得意分野</dt>
            <dd>{p.expertise_tags.join("・")}</dd>
            <dt>登壇の意向</dt>
            <dd>{intentLabel(p.speaking_intent)}</dd>
            <dt>NGのテーマ</dt>
            <dd>{p.ng_themes.length ? p.ng_themes.join("・") : "なし"}</dd>
          </dl>
        ) : (
          <div className="person-edit">
            <label className="field">
              <span className="field-label">得意分野（「、」で区切る）</span>
              <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <fieldset className="field">
              <legend className="field-label">登壇の意向</legend>
              <div className="seg" role="radiogroup" aria-label="登壇の意向">
                {INTENT.map(([k, label]) => (
                  <button key={k} type="button" className="chip" role="radio" aria-checked={intent === k} aria-pressed={intent === k} onClick={() => setIntent(k)}>
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span className="field-label">NGのテーマ（「、」で区切る。Agentはこのテーマでは推しません）</span>
              <input className="input" value={ng} onChange={(e) => setNg(e.target.value)} placeholder="例：採用の話、決済まわり" />
            </label>
          </div>
        )}
        <ErrorLine message={error} />
        <div className="btn-row">
          {!editing ? (
            <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
              人の情報を直す
            </button>
          ) : (
            <>
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={save}>
                {busy ? "保存しています…" : "保存して確認済みにする"}
              </button>
              <button type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing(false)}>
                やめる
              </button>
            </>
          )}
          {p.edited_fields.length > 0 && <span className="meta">人が直した項目：{p.edited_fields.map((f) => FIELD[f] ?? f).join("、")}（Agentは上書きしません）</span>}
        </div>
      </section>

      {cards.length > 0 && (
        <section className="surface" aria-labelledby="pd-cards">
          <h3 id="pd-cards" className="h3 pad-head">
            ネタ <span className="meta">{cards.length}枚</span>
          </h3>
          <ul className="nb-list">
            {cards.map((c) => (
              <li key={c.card_id}>
                <button type="button" className="nb-row" onClick={() => onOpenCard(c.card_id)}>
                  <span className="nb-who">
                    <span className="nb-theme strong-theme">{c.themes[0]}</span>
                    <span className="grow" />
                    <span className="tags nb-marks">
                      <CardMarks card={c} />
                      {acceptedRequestIds(c).length > 0 && <Tag tone="ok">承諾済みの依頼あり</Tag>}
                    </span>
                  </span>
                  {c.pending_themes.length > 0 && <span className="meta">新しいテーマ案（未確認）があります</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RecentBlogs blogs={detail.blogs ?? []} />

      <section className="surface pad-lg" aria-labelledby="pd-acts">
        <h3 id="pd-acts" className="h3">
          最近の活動
        </h3>
        {detail.recent_activities.length === 0 ? (
          <p className="meta">活動の記録はまだありません。</p>
        ) : (
          <ul className="plain-list small">
            {detail.recent_activities.map((x) => (
              <li key={x.id}>
                <span className="meta">
                  {md(x.date)}・{ACTIVITY_LABEL[x.type] ?? x.type}
                </span>
                {"　"}
                {x.url ? (
                  <a href={x.url} target="_blank" rel="noreferrer">
                    {x.title}
                  </a>
                ) : (
                  x.title
                )}
              </li>
            ))}
          </ul>
        )}
        {detail.published.length > 0 && (
          <>
            <h4 className="h4">発信の記録</h4>
            <ul className="plain-list small">
              {detail.published.map((x) => (
                <li key={x.id}>
                  <span className="meta">
                    {md(x.date)}・{x.genre}
                  </span>
                  　{x.title}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
