// プロダクトのリリースノート（data/sources/release_notes.json）を、ネタ帳の材料にする。
// リリースノートは「何を作り、誰の何を解いたか」がまとまっていて、登壇ネタの材料として濃い。
//
// - 活動の1種類（type: "release_note"、id は rel001 など）として activities() に入る。url は公開ページ
// - 担当者（活動の author_id）は次の順で決まる。どれもなければ空（""）で、推測では埋めない
//     1. 技術広報が割り当てた人（data/release_owners.json の by="human"）
//     2. データに書いてある担当者（release_notes.json の owner_id。架空の社員への架空の割り当て）
//     3. キーワード一致で見つけた候補から AI が選び、コードで確かめた人（by="match"。候補の外・根拠なしは認めない）
// - 担当者が決まらないものは「担当者未定のネタ」（data/unassigned_cards.json）にする。カード（data/cards.json）とは分け、
//   候補の検索（依頼 → 人）には出さない。割り当てられたらその人の普通のカードになり、確認済みとして扱う
// - リリースノート自体は「発信済み」ではない（登壇やブログはまだ）
// 架空の会社のデータだけで使う（DATA_SOURCE=github のときは入れない）。評価は RELEASE_NOTES=off で入れない。
import fs from "node:fs";
import { writeJsonAtomic } from "./fileStore";
import { readOverlay, readReplaced, writeOverlay, writeReplaced } from "./runtime";
import path from "node:path";
import type { Activity } from "./data";
import { dataSource } from "./dataSource";

export interface ReleaseNote {
  id: string;
  date: string;
  product: string;
  title: string;
  url: string;
  /** 自分の言葉で2〜3文（原文を写さない） */
  summary: string;
  /** 担当チーム（架空の割り当て） */
  team: string | null;
  /** 担当者（架空の社員への架空の割り当て）。分からないものは null */
  owner_id: string | null;
}

/** 担当者が決まった経緯。human＝技術広報が割り当て、match＝キーワード一致＋AI の判断（employee_id が null なら決まらなかった） */
export interface OwnerRecord {
  employee_id: string | null;
  by: "human" | "match";
  /** match のとき：根拠にした、その人の活動（キーワードで一致したもの） */
  matched_activity_ids: string[];
  reason: string;
  at: string;
}

export interface UnassignedCard {
  card_id: string;
  /** 担当者未定。割り当てられるまで null のまま */
  employee_id: null;
  release_note_ids: string[];
  summary: string;
  themes: string[];
  format: "talk" | "lt" | "blog";
  format_reason: string;
  /** 「同じ機能に触れている活動」が見つかった人（参考。割り当ての決め手にはしない） */
  related_employee_ids: string[];
  created_at: string;
  updated_at: string;
}

const DATA_DIR = () => path.join(process.cwd(), "data");
const NOTES_FILE = () => path.join(DATA_DIR(), "sources", "release_notes.json");
const OWNERS_FILE = () => process.env.RELEASE_OWNERS_FILE || path.join(DATA_DIR(), "release_owners.json");
const UNASSIGNED_FILE = () => process.env.UNASSIGNED_CARDS_FILE || path.join(DATA_DIR(), "unassigned_cards.json");

export function releaseNotesOn(): boolean {
  if (dataSource()) return false;
  return (process.env.RELEASE_NOTES ?? "").trim().toLowerCase() !== "off";
}

function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as T) : fallback;
}
function writeJson(file: string, value: unknown) {
  writeJsonAtomic(file, value);
}

export const releaseNotes = (): ReleaseNote[] => (releaseNotesOn() ? readJson<ReleaseNote[]>(NOTES_FILE(), []) : []);
// 元のデータ（data/release_owners.json・data/unassigned_cards.json）は読むだけ。割り当てなどの結果は data/runtime/ に置く（lib/runtime.ts）。
// テストでは RELEASE_OWNERS_FILE・UNASSIGNED_CARDS_FILE でそのファイルを直接使う
const BASE_OWNERS = () => path.join(DATA_DIR(), "release_owners.json");
const BASE_UNASSIGNED = () => path.join(DATA_DIR(), "unassigned_cards.json");
export const ownerRecords = (): Record<string, OwnerRecord> =>
  process.env.RELEASE_OWNERS_FILE ? readJson(OWNERS_FILE(), {}) : readOverlay<OwnerRecord>([BASE_OWNERS()], "release_owners.json");
export const saveOwnerRecords = (r: Record<string, OwnerRecord>) =>
  process.env.RELEASE_OWNERS_FILE ? writeJson(OWNERS_FILE(), r) : writeOverlay([BASE_OWNERS()], "release_owners.json", r);
export const unassignedCards = (): UnassignedCard[] =>
  !releaseNotesOn() ? [] : process.env.UNASSIGNED_CARDS_FILE ? readJson<UnassignedCard[]>(UNASSIGNED_FILE(), []) : readReplaced<UnassignedCard[]>(BASE_UNASSIGNED(), "unassigned_cards.json", []);
export const saveUnassignedCards = (c: UnassignedCard[]) =>
  process.env.UNASSIGNED_CARDS_FILE ? writeJson(UNASSIGNED_FILE(), c) : writeReplaced("unassigned_cards.json", c);

/** 担当者（なければ null）。技術広報の割り当て > データの担当者 > キーワード一致＋AI の判断 */
export function ownerOf(note: ReleaseNote, records = ownerRecords()): string | null {
  const r = records[note.id];
  if (r?.by === "human" && r.employee_id) return r.employee_id;
  if (note.owner_id) return note.owner_id;
  if (r?.by === "match" && r.employee_id) return r.employee_id;
  return null;
}

/** リリースノートを活動の形にする（担当者が決まらないものは author_id が空） */
export function releaseActivities(): Activity[] {
  const records = ownerRecords();
  return releaseNotes().map((n) => ({
    id: n.id,
    type: "release_note" as const,
    author_id: ownerOf(n, records) ?? "",
    date: n.date,
    title: `${n.product}：${n.title}`,
    body: `${n.summary}${n.team ? `（担当：${n.team}）` : ""}`,
    channel: null,
    repo: null,
    url: n.url,
  }));
}

// ---- 同じ機能に触れている活動を、キーワード一致で探す（コード） ------------------------------------

const STOP = new Set([
  "機能", "提供", "開始", "提供開始", "リリース", "正式", "対応", "業務", "サービス", "バクラク", "可能", "利用", "企業", "担当", "担当者",
  "自動", "管理", "情報", "確認", "作業", "負担", "課題", "支援", "一元", "画面", "手間", "形式", "現在", "今後", "これ", "ため", "よう",
  // どの取り組みにも出てくる言葉（一致しても同じ機能とは言えない）
  "ai", "エージェント", "追加", "作成", "時間", "データ", "原因", "判断", "社内", "質問", "修正", "完結", "両方", "実態", "部門", "個人",
  "ツール", "改善", "削減", "導入", "連携", "最新版", "発行", "従業員", "申請", "承認", "入社",
]);

/** 日本語の文から、カタカナ・漢字・英数字の2文字以上のかたまりを取り出す */
export function keywordsOf(text: string): string[] {
  const words = text.match(/[ァ-ヶー]{2,}|[一-龠々]{2,}|[A-Za-z][A-Za-z0-9]+/g) ?? [];
  return [...new Set(words.map((w) => w.toLowerCase()).filter((w) => !STOP.has(w) && w.length >= 2))];
}

export interface OwnerCandidate {
  employee_id: string;
  /** その人の活動のうち、キーワードが2つ以上一致したもの（多い順、3件まで） */
  activity_ids: string[];
  matched_keywords: string[];
  score: number;
}

/**
 * 担当者のいないリリースノートについて、同じ機能に触れている活動を持つ人を探す（キーワード一致、上位3人まで）。
 * 2つ以上のキーワードが一致した活動がなければ候補なし。
 */
export function ownerCandidates(note: ReleaseNote, acts: Activity[]): OwnerCandidate[] {
  const keys = keywordsOf(`${note.product} ${note.title} ${note.summary}`);
  const byPerson = new Map<string, { ids: Array<{ id: string; n: number }>; words: Set<string> }>();
  for (const a of acts) {
    if (a.type === "release_note" || !a.author_id) continue;
    const hay = `${a.title} ${a.body}`.toLowerCase();
    const hit = keys.filter((k) => hay.includes(k));
    if (hit.length < 2) continue;
    const p = byPerson.get(a.author_id) ?? { ids: [], words: new Set<string>() };
    p.ids.push({ id: a.id, n: hit.length });
    hit.forEach((w) => p.words.add(w));
    byPerson.set(a.author_id, p);
  }
  return [...byPerson.entries()]
    .map(([employee_id, p]) => ({
      employee_id,
      activity_ids: p.ids.sort((x, y) => y.n - x.n).slice(0, 3).map((x) => x.id),
      matched_keywords: [...p.words],
      score: p.ids.reduce((s, x) => s + x.n, 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/**
 * AI が選んだ担当者を確かめる（コード）。認めるのは「キーワード一致の候補にいて、その人の一致した活動を根拠に挙げた」ときだけ。
 * それ以外（候補の外・根拠なし・ほかの人の活動）はエラー。null（決めない）はいつでもよい。
 */
export function checkMatch(
  candidates: OwnerCandidate[],
  choice: { employee_id: string | null; evidence_activity_ids: string[] },
): string[] {
  if (!choice.employee_id) return choice.evidence_activity_ids.length ? ["担当者を決めないときは、根拠の活動を空にしてください"] : [];
  const c = candidates.find((x) => x.employee_id === choice.employee_id);
  if (!c) return [`${choice.employee_id} は、同じ機能に触れている活動が見つかった人ではありません。候補の中から選ぶか、決めずに空にしてください`];
  if (!choice.evidence_activity_ids.length) return [`${choice.employee_id} を担当者にする根拠の活動がありません`];
  const bad = choice.evidence_activity_ids.filter((id) => !c.activity_ids.includes(id));
  if (bad.length) return [`根拠 ${bad.join(", ")} は、${choice.employee_id} の一致した活動ではありません`];
  return [];
}
