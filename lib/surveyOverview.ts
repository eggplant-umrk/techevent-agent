// 保存した分析結果（EventAnalysis）から、画面用のイベント単位の集計（overview の analysis）を作る。
// 画面（モック）からも使うので、ファイルやデータを読まない純粋な関数だけにする。
// 登壇者ごとの点数・まとめ・不満の登壇者・良い点の登壇者は入れない。
import type { EventAnalysis, EventOverview, NegativeItem } from "./surveys";

export function analysisOverview(a: EventAnalysis): NonNullable<EventOverview["analysis"]> {
  const next = new Map<string, { text: string; count: number; demand: boolean }>();
  for (const n of a.talks.flatMap((t) => t.next_themes)) {
    const x = next.get(n.text) ?? { text: n.text, count: 0, demand: false };
    x.count += n.response_ids.length;
    x.demand ||= !!n.overlaps_card_id;
    next.set(n.text, x);
  }
  const neg = (items: NegativeItem[]) => items.map((n) => ({ text: n.text, count: n.count, attack: n.attack }));
  return {
    analyzed_at: a.analyzed_at,
    negatives: { operation: neg(a.negatives.operation), content: neg(a.negatives.content) },
    positives: a.positives.map((p) => ({
      theme: p.theme,
      count: p.count,
      scope: p.speaker_id === null ? ("event" as const) : ("talk" as const),
      representatives: p.representatives.map((r) => r.text),
    })),
    next_themes: [...next.values()].sort((x, y) => y.count - x.count),
  };
}

// ---------------------------------------------------------------------------
// アンケートの声（ネタ帳タブ）：参加者が「今後聞いてみたい話」を、イベント名・日付・件数つきで並べる
// 合う人（別の社員の未発信カードと重なる＝「需要あり」の仕組み）がいればその人とカード、いなければ null
// どの登壇への声かは出さない（イベント単位）
// ---------------------------------------------------------------------------
export interface SurveyVoice {
  text: string;
  count: number;
  event_id: string;
  event_title: string;
  event_date: string;
  /** 合う人（需要あり）。いなければ null（画面は「まだ話せる人がいない」） */
  match: { card_id: string; employee_id: string; name: string } | null;
}

export function surveyVoices(
  analyses: Array<Pick<EventAnalysis, "event_id" | "talks">>,
  events: Array<{ id: string; title: string; date: string }>,
  cards: Array<{ card_id: string; employee_id: string; name: string }>,
): SurveyVoice[] {
  const out: SurveyVoice[] = [];
  for (const a of analyses) {
    const ev = events.find((e) => e.id === a.event_id);
    if (!ev) continue;
    const byText = new Map<string, SurveyVoice>();
    for (const n of a.talks.flatMap((t) => t.next_themes)) {
      const text = n.text.trim();
      if (!text) continue;
      const v = byText.get(text) ?? { text, count: 0, event_id: ev.id, event_title: ev.title, event_date: ev.date, match: null };
      v.count += n.response_ids.length;
      if (!v.match && n.overlaps_card_id) {
        const c = cards.find((x) => x.card_id === n.overlaps_card_id);
        if (c) v.match = { card_id: c.card_id, employee_id: c.employee_id, name: c.name };
      }
      byText.set(text, v);
    }
    out.push(...byText.values());
  }
  return out.sort((x, y) => (x.event_date === y.event_date ? y.count - x.count : x.event_date < y.event_date ? 1 : -1));
}

/** アンケート由来のテーマか（カードのテーマ案・「需要あり」にタグを付けるため）。声の文と同じ文なら由来とみなす */
export const isSurveyTheme = (theme: string, voices: Array<{ text: string }>) => voices.some((v) => v.text === theme.trim());
