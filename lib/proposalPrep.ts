// 依頼 → 候補の準備を速くするための、コードでやる前処理と後処理（AI は使わない）。
//   1. 最初の検索をコードで先にやる：依頼のテーマ（読み取った項目）でネタ帳を検索し、上位の人の基本情報・予定の埋まり・
//      カードの要約と根拠を、最初の指示にまとめて渡す。Agent は足りなければ今までどおりツールで探し直す
//   2. コードで出せる注意点はコードが足す：予定が詰まっている・予定は不明・予定が重なる・日程が未定・カードが未確認。
//      Agent には、理由と、コードで出せない注意点だけを書かせる（同じことを書いても表示の前に除く）
import { getCardById, loadCards, outreachSummary } from "./cards";
import { activities, employeeById, eventDateOf, schedules, type SpeakingRequest } from "./data";
import { busyForAgent, busynessFor, busyText } from "./busyness";
import { searchCards } from "./tools";

/** 検索に使わない、依頼にいつも出てくる言葉 */
const GENERIC = new Set([
  "勉強会", "ミートアップ", "meetup", "lt", "ナイト", "night", "合同", "vol", "登壇", "社外", "向け", "企業", "エンジニア", "イベント",
  "セッション", "パネル", "トーク", "オンライン", "オフライン", "開催", "依頼", "お願い", "参加者", "名", "約", "分", "共催", "打診", "テーマ",
  "おまかせ", "お任せ", "学ぶ", "会", "実践", "day", "winter", "summer", "spring", "autumn",
]);

function terms(text: string): string[] {
  const words = text.match(/[ァ-ヶー]{2,}|[一-龠々]{2,}|[A-Za-z][A-Za-z0-9]+/g) ?? [];
  const out: string[] = [];
  for (const w of words.map((x) => x.toLowerCase())) {
    if (GENERIC.has(w) || /^\d+$/.test(w)) continue;
    // 漢字の続き（「障害対応」「初期表示改善」など）は、カードの言い回しと合うように2文字ずつに分ける
    if (/^[一-龠々]{3,}$/.test(w)) for (let i = 0; i + 2 <= w.length; i++) out.push(w.slice(i, i + 2));
    else out.push(w);
  }
  return [...new Set(out.filter((w) => !GENERIC.has(w)))];
}

/** 依頼から検索の言葉を作る。テーマ（指定・読み取り）を優先し、なければイベント名と聴衆。枠だけの依頼は言葉なし（新しい順） */
export function prefetchQuery(r: SpeakingRequest): string {
  const theme = r.theme ?? r.intake?.theme ?? null;
  const parts = theme ? [theme] : [r.event?.title, r.intake?.event_name, r.event?.audience].filter((x): x is string => !!x);
  if (!theme && r.pattern === "open_slot") return "";
  return terms(parts.join(" ")).slice(0, 12).join(" ");
}

const PREFETCH_COUNT = 8;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/**
 * 最初の指示に添える、先に調べたネタ帳の候補（コードで検索）。seen は、ここで見せた根拠の活動 id（Agent が根拠に使ってよい）。
 * 指名された本人のカードがあれば、検索に当たらなくても入れる。
 */
export function prefetchForAgent(r: SpeakingRequest): { text: string; seen: string[]; query: string } {
  const query = prefetchQuery(r);
  const res = searchCards({ query, ...(r.pattern === "open_slot" && !query ? { filter: { unpublished_only: true } } : {}) }) as {
    results: Array<{ card_id: string }>;
  };
  const ids = res.results.map((x) => x.card_id).slice(0, PREFETCH_COUNT);
  if (r.nominated_employee_id) {
    for (const c of loadCards().filter((c) => c.employee_id === r.nominated_employee_id)) if (!ids.includes(c.card_id)) ids.push(c.card_id);
  }
  const acts = new Map(activities().map((a) => [a.id, a]));
  const seen: string[] = [];
  const lines = ids
    .map((id) => getCardById(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    // 今の材料にある根拠が1つもないカード（リリースノートやブログを入れていないときの、それだけが根拠のカードなど）は渡さない
    .filter((c) => c.evidence_activity_ids.some((id) => acts.has(id)) || c.employee_id === r.nominated_employee_id)
    .map((c) => {
      const e = employeeById(c.employee_id);
      // 根拠は、今の材料にある活動だけを見せる（ない id を根拠に使って差し戻されないように）
      const evIds = c.evidence_activity_ids.filter((id) => acts.has(id));
      seen.push(...evIds);
      const ev = evIds.map((id) => `${id} ${clip(acts.get(id)?.title ?? "", 36)}`).join("／");
      return `- ${c.card_id}｜${c.employee_id} ${e?.name ?? ""}｜${e?.business_unit ?? ""}・${e?.role ?? ""}｜登壇${e?.past_talk_count ?? 0}回｜${busyForAgent(busynessFor(c.employee_id))}｜${c.reviewed ? "確認済み" : "未確認"}・${c.publication_status}
  テーマ案：${c.themes.join(" / ")}
  要約：${clip(c.summary, 140)}
  根拠：${ev || "なし"}｜打診：${outreachSummary(c)}`;
    });
  const head = query ? `「${query}」でネタ帳を検索した上位` : "枠だけの依頼なので、未発信のカードを新しい順に";
  const text = lines.length
    ? `\n\n# 先に調べたネタ帳の候補（コードで検索。${head}${lines.length}枚）\nこれを出発点にしてください。合う人が足りない・テーマがずれると思えば、search_cards や search_activities で探し直してください。打診履歴や根拠の中身をもっと見るなら get_card を使ってください。予定の埋まり・予定の重なり・カードが未確認なことは、注意点としてコードが足します。\n${lines.join("\n")}`
    : `\n\n# 先に調べたネタ帳の候補\n「${query}」ではカードが見つかりませんでした。search_cards や search_activities で言葉を変えて探してください。`;
  return { text, seen, query };
}

/** コードで出せる注意点（候補ごと）。Agent には書かせない */
export function computedCautions(employeeId: string, request: SpeakingRequest, cardId: string | null): string[] {
  const out: string[] = [];
  const busy = busynessFor(employeeId);
  if (!busy.known) out.push("予定は不明なので、準備時間が取れるか本人への確認が必要");
  else if (busy.level === "詰まっている") out.push(busyText(busy));
  const eventDate = eventDateOf(request);
  if (eventDate) {
    const hit = schedules().find((s) => s.employee_id === employeeId && s.from <= eventDate && s.to >= eventDate);
    if (hit) out.push(`予定が重なる（${hit.kind} ${hit.from}〜${hit.to}）`);
  } else if (!request.candidate_dates?.length) {
    // 会話に候補日の一覧がある依頼では足さない（候補日ごとの都合「候補日のうち 1/14 だけ都合がよい」をコードが足すため。lib/inbox.ts）
    out.push("日程が未定なので、予定が重ならないかは日程が決まったら確認");
  }
  const card = cardId ? getCardById(cardId) : undefined;
  if (card && !card.reviewed) out.push("ネタ帳の記録は技術広報が未確認");
  return out;
}

/** Agent が書いた注意点のうち、コードが足すものと同じことだけを言っている文 */
const COMPUTABLE = [
  /^(今後2週間|この2週間)/,
  /予定(で|の)埋ま|予定の埋まり|予定に余裕|予定は(空いて|詰まって)/,
  /予定は不明|予定が(分から|わから)ない/,
  /予定が重な|予定の重なり(は)?(ない|なし)|前後.{0,8}予定(は|が)(ない|入っていない|見当たらない)/,
  /日程(が|は)(未定|決まって(い)?ない)|日程が決まったら/,
  /(ネタ帳|カード)(の記録)?(は|が)(技術広報が)?(まだ)?(未確認|確認していない|確認前)/,
];
export function dropComputableCautions(cautions: string[]): string[] {
  return cautions.filter((c) => !COMPUTABLE.some((re) => re.test(c)));
}
