// イベントページ（架空）：connpass などの告知ページがないイベントのとき、アプリの中で見せる告知ページ（/events/{id}）。
// 中身はデータからコードで作る（AI は使わない）。告知文も決まった形の文。本番では connpass のイベントページに飛ぶ。
import { employeeById, events } from "./data";
import { loadImport } from "./surveyCsv";

export interface FictionalEventPage {
  id: string;
  title: string;
  series: string;
  date: string;
  weekday: string | null;
  start_time: string | null;
  venue: string;
  /** 形式（例：勉強会・登壇2本・懇親会あり） */
  format: string;
  speakers: Array<{ name: string; business_unit: string; title: string | null }>;
  attendees: number;
  /** 架空の告知文（2〜3文） */
  description: string;
}

/** イベントの告知ページの行き先。connpass_url があればそれ、なければアプリの中の架空のページ */
export function eventPageHref(ev: { id: string; connpass_url?: string }): { href: string; external: boolean } {
  const url = ev.connpass_url?.trim();
  return url ? { href: url, external: true } : { href: `/events/${encodeURIComponent(ev.id)}`, external: false };
}

export function fictionalEventPage(id: string): FictionalEventPage | null {
  const ev = events().find((e) => e.id === id);
  if (!ev) return null;
  const titles = loadImport(id)?.talk_titles ?? {};
  const speakers = ev.speaker_ids.map((sid) => {
    const e = employeeById(sid);
    return { name: e?.name ?? sid, business_unit: e?.business_unit ?? "", title: titles[sid] ?? null };
  });
  const party = !!ev.catering && ev.catering.food_servings_ordered > 0;
  const format = [ev.venue_type === "external" ? "外部会場での勉強会" : "勉強会", `登壇${speakers.length}本`, party ? "懇親会あり" : ""].filter(Boolean).join("・");
  const talks = speakers.filter((s) => s.title).map((s) => `「${s.title}」`);
  const description = [
    `${ev.series}の${ev.title.replace(ev.series, "").trim() || "回"}を開催します。`,
    talks.length ? `今回は${speakers.map((s) => s.name).join("・")}が、${talks.join("と")}についてお話しします。` : `今回は${speakers.map((s) => s.name).join("・")}が登壇します。`,
    party ? "登壇のあとは懇親会もありますので、ぜひ気軽にご参加ください。" : "",
  ]
    .filter(Boolean)
    .join("");
  return {
    id: ev.id,
    title: ev.title,
    series: ev.series,
    date: ev.date,
    weekday: ev.weekday ?? null,
    start_time: ev.start_time ?? null,
    venue: ev.venue,
    format,
    speakers,
    attendees: ev.attendees,
    description,
  };
}
