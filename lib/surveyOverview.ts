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
