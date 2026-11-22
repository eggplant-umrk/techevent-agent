// 続きの会話の見分けと、前との違い（どちらもコード。AI は使わない）。
//   - 貼った文が、受信箱の依頼の会話をまるごと含んでいれば、その依頼の続き（contains）
//   - 含んではいないが、同じ X のアカウント（最初に出てくる @…）で、同じイベント名が文の中にあれば、人に聞く（ask）
//   - 変わった項目は、前の読み取りと今の読み取りを比べて一覧にする
import { dateLabel } from "./dateHint";

/** 空白・改行の違いをならす（全部取る）。含むかどうかを比べるための形 */
export const squash = (text: string) => text.replace(/[\s　]+/g, "");

/** 文の中の X のアカウント（@…）。出てきた順・重複なし・小文字 */
export function accountsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/@([A-Za-z0-9_]{2,30})/g)) {
    const a = m[1].toLowerCase();
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

export interface ContinuationTarget {
  id: string;
  text: string;
  /** 読み取ったイベント名（なければ null） */
  event_name: string | null;
}

export type Continuation = { kind: "contains"; id: string } | { kind: "ask"; id: string; title: string } | null;

/** 続きの会話か。targets はアーカイブを除いた受信箱の依頼（新しい順） */
export function findContinuation(text: string, targets: ContinuationTarget[]): Continuation {
  const mine = squash(text);
  if (!mine) return null;
  // 同じ文は「同じ依頼」（追加の窓口が先に見る）。続きとしては扱わない
  if (targets.some((t) => squash(t.text) === mine)) return null;
  // まるごと含む（同じ文は「同じ依頼」なので、ここでは扱わない）。いちばん長い会話を含むものを選ぶ
  const contained = targets
    .map((t) => ({ t, key: squash(t.text) }))
    .filter((x) => x.key.length >= 20 && x.key !== mine && mine.includes(x.key))
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (contained) return { kind: "contains", id: contained.t.id };
  // 同じアカウント（会話を始めた人＝最初の @）と同じイベント名
  const first = accountsIn(text)[0];
  if (!first) return null;
  const hit = targets.find((t) => {
    const name = t.event_name ? squash(t.event_name) : "";
    return name.length >= 3 && accountsIn(t.text)[0] === first && mine.includes(name);
  });
  return hit ? { kind: "ask", id: hit.id, title: hit.event_name! } : null;
}

export interface IntakeChange {
  /** date・nominee・theme のどれかなら、候補づくりをやり直す */
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface ReadingSnapshot {
  nominee_name: string | null;
  intake: {
    event_name?: string | null;
    date?: string | null;
    date_hint?: string | null;
    format?: string | null;
    theme?: string | null;
    extra?: Record<string, string | null | undefined> | null;
  } | null;
}

const UNDECIDED = "未定";
const NONE = "なし";

function dateText(i: ReadingSnapshot["intake"]): string {
  if (i?.date) return dateLabel(i.date);
  return i?.date_hint ? `${UNDECIDED}（${i.date_hint}）` : UNDECIDED;
}

/** 候補づくりをやり直す項目 */
export const RERUN_FIELDS = new Set(["date", "nominee", "theme"]);

/** 前の読み取りと今の読み取りの違い（「日程：未定 → 12月17日（木）」の材料） */
export function intakeChanges(before: ReadingSnapshot, after: ReadingSnapshot): IntakeChange[] {
  const out: IntakeChange[] = [];
  const add = (field: string, label: string, from: string, to: string) => {
    if (from !== to) out.push({ field, label, from, to });
  };
  const v = (x: string | null | undefined) => (x && x.trim() ? x.trim() : UNDECIDED);
  add("date", "日程", dateText(before.intake), dateText(after.intake));
  add("nominee", "指名", before.nominee_name ? `${before.nominee_name}さん` : NONE, after.nominee_name ? `${after.nominee_name}さん` : NONE);
  add("theme", "テーマ", v(before.intake?.theme), v(after.intake?.theme));
  add("event_name", "イベント名", v(before.intake?.event_name), v(after.intake?.event_name));
  add("format", "形式", v(before.intake?.format), v(after.intake?.format));
  const extras: Array<[string, string]> = [
    ["duration", "持ち時間"],
    ["audience_size", "人数"],
    ["audience", "対象者"],
    ["venue", "会場"],
    ["recording", "録画"],
    ["reward", "謝礼"],
    ["reply_deadline", "返事の期限"],
  ];
  for (const [k, label] of extras) add(k, label, v(before.intake?.extra?.[k]), v(after.intake?.extra?.[k]));
  return out;
}

export const needsRerun = (changes: IntakeChange[]) => changes.some((c) => RERUN_FIELDS.has(c.field));

/** 画面に出す1行（「日程：未定 → 12月17日（木）」） */
export const changeLine = (c: IntakeChange) => `${c.label}：${c.from} → ${c.to}`;
