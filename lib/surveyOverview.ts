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
    sample: !!a.sample,
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
// 話せそうな人：
//   - 別の社員の未発信カードと重なる声は、その人とカード（「需要あり」の仕組み）
//   - 重ならない声は、登壇者本人が続編として話せる（書き戻しで本人のカードにテーマ案として入る）ので、その人とカード
//   - どちらもいなければ null（画面は「まだ話せる人がいない」）
// どの登壇への声か（続編かどうか）は出さない。「話せそうな人」として出すだけ
// どの登壇への声かは出さない（イベント単位）
// ---------------------------------------------------------------------------
export interface SurveyVoice {
  text: string;
  count: number;
  event_id: string;
  event_title: string;
  event_date: string;
  /** 話せそうな人。いなければ null（画面は「まだ話せる人がいない」） */
  match: { card_id: string; employee_id: string; name: string } | null;
  /** 架空のアンケートの保存済み分析結果から出した声 */
  sample: boolean;
}

export function surveyVoices(
  analyses: Array<Pick<EventAnalysis, "event_id" | "talks" | "sample">>,
  events: Array<{ id: string; title: string; date: string }>,
  cards: Array<{ card_id: string; employee_id: string; name: string; themes?: string[] }>,
): SurveyVoice[] {
  /** 登壇者本人のカード：その声をテーマ（案）に持つカード、なければ先頭（呼び出し側が新しい順に並べて渡す） */
  const ownCard = (speakerId: string, text: string) => {
    const mine = cards.filter((c) => c.employee_id === speakerId);
    return mine.find((c) => c.themes?.includes(text)) ?? mine[0];
  };
  const out: SurveyVoice[] = [];
  for (const a of analyses) {
    const ev = events.find((e) => e.id === a.event_id);
    if (!ev) continue;
    const byText = new Map<string, SurveyVoice>();
    const own = new Map<string, { card_id: string; employee_id: string; name: string }>();
    for (const t of a.talks)
      for (const n of t.next_themes) {
        const text = n.text.trim();
        if (!text) continue;
        const v = byText.get(text) ?? { text, count: 0, event_id: ev.id, event_title: ev.title, event_date: ev.date, match: null, sample: !!a.sample };
        v.count += n.response_ids.length;
        if (!v.match && n.overlaps_card_id) {
          const c = cards.find((x) => x.card_id === n.overlaps_card_id);
          if (c) v.match = { card_id: c.card_id, employee_id: c.employee_id, name: c.name };
        }
        if (!n.overlaps_card_id && !own.has(text)) {
          const c = ownCard(t.speaker_id, text);
          if (c) own.set(text, { card_id: c.card_id, employee_id: c.employee_id, name: c.name });
        }
        byText.set(text, v);
      }
    // 別の社員と重ならない声は、登壇者本人を話せそうな人にする
    for (const v of byText.values()) if (!v.match) v.match = own.get(v.text) ?? null;
    out.push(...byText.values());
  }
  return out.sort((x, y) => (x.event_date === y.event_date ? y.count - x.count : x.event_date < y.event_date ? 1 : -1));
}

/** アンケート由来のテーマか（カードのテーマ案・「需要あり」にタグを付けるため）。声の文と同じ文なら由来とみなす */
export const isSurveyTheme = (theme: string, voices: Array<{ text: string }>) => voices.some((v) => v.text === theme.trim());
