// イベントページ（架空）（/events/{id}）。アーカイブのイベント画面の「イベントページを開く」から開く。
// connpass などの告知ページがあるイベントはそのページを開くので、ここに出すのは告知ページのない架空のイベントだけ（lib/eventPage.ts）。
// 見た目はこのアプリのまま（connpass の見た目やロゴは真似しない）。
import Link from "next/link";
import { notFound } from "next/navigation";
import { fictionalEventPage } from "@/lib/eventPage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ev = fictionalEventPage(id);
  if (!ev) notFound();
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 16px" }}>
      <p className="meta">
        <Link href="/?tab=archive">← ネタ帳Agent に戻る</Link>
      </p>
      <article className="surface pad-lg" aria-labelledby="event-title">
        <p
          role="note"
          style={{ margin: 0, padding: "8px 12px", borderRadius: 8, background: "var(--warn-soft)", color: "var(--warn)", fontSize: 13 }}
        >
          架空のイベントページです。本番では connpass のイベントページに飛びます。
        </p>
        <p className="meta" style={{ marginTop: 12 }}>
          {ev.series}
        </p>
        <h1 id="event-title" style={{ margin: "4px 0 8px", fontSize: 22, lineHeight: 1.4 }}>
          {ev.title}
        </h1>
        <dl className="person-facts">
          <dt>日時</dt>
          <dd>
            {ev.date}
            {ev.weekday ? `（${ev.weekday}）` : ""}
            {ev.start_time ? ` ${ev.start_time}〜` : ""}
          </dd>
          <dt>会場</dt>
          <dd>{ev.venue}</dd>
          <dt>形式</dt>
          <dd>{ev.format}</dd>
          <dt>参加者</dt>
          <dd>{ev.attendees}人</dd>
        </dl>
        <h2 className="h3">登壇</h2>
        <ul className="plain-list">
          {ev.speakers.map((s) => (
            <li key={s.name}>
              <span className="strong">{s.name}</span>
              <span className="meta">（{s.business_unit}）</span>
              {s.title ? `「${s.title}」` : ""}
            </li>
          ))}
        </ul>
        <h2 className="h3" style={{ marginTop: 16 }}>
          イベントについて
        </h2>
        <p style={{ lineHeight: 1.9 }}>{ev.description}</p>
        <p className="meta">告知文は架空です（データからコードで作った文）。</p>
      </article>
    </main>
  );
}
