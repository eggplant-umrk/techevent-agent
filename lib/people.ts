// 人の情報（ネタ帳タブの「人」）。社員データ（employees.json）に、技術広報が画面で直した内容を重ねる。
// 直した項目は「人が確認済み」になり、Agent やほかの自動処理は上書きしない（applyAutoPersonUpdate を通す）。
import fs from "node:fs";
import { runtimeFile } from "./runtime";
import { blogsOf, type BlogItem } from "./blogView";
import path from "node:path";
import { activities, employeeById, employees, published, type Employee } from "./data";
import { loadCards } from "./cards";
import { talkTag, type TalkTag } from "./talkTag";
import { isDemoPerson } from "./demoPerson";

// 人の情報を直した結果は実行時のデータ（data/runtime/people.json、git の対象外）。元のデータ（employees.json）は書かない
const FILE = () => process.env.PEOPLE_FILE || runtimeFile("people.json");

/** 登壇の意向。unknown は「未確認」 */
export type SpeakingIntent = "available" | "hold" | "unknown";
export const INTENT_LABEL: Record<SpeakingIntent, string> = {
  available: "今は受けられる",
  hold: "今は控えたい",
  unknown: "未確認",
};

export type PersonField = "expertise_tags" | "speaking_intent" | "ng_themes";

export interface PersonOverride {
  expertise_tags?: string[];
  speaking_intent?: SpeakingIntent;
  ng_themes?: string[];
  /** 人が直した項目（Agent・自動処理は上書きしない） */
  edited_fields: PersonField[];
  reviewed: boolean;
  updated_at: string;
}

function load(): Record<string, PersonOverride> {
  const f = FILE();
  if (!fs.existsSync(/*turbopackIgnore: true*/ f)) return {};
  return JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ f, "utf-8")) as Record<string, PersonOverride>;
}

function save(all: Record<string, PersonOverride>) {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(/*turbopackIgnore: true*/ FILE(), JSON.stringify(all, null, 2) + "\n", "utf-8");
}

export interface Person {
  id: string;
  name: string;
  business_unit: string;
  role: string;
  expertise_tags: string[];
  speaking_intent: SpeakingIntent;
  ng_themes: string[];
  past_talk_count: number;
  last_talk_date: string | null;
  reviewed: boolean;
  edited_fields: PersonField[];
}

/** 社員データに、人が直した内容を重ねたもの */
export function personOf(e: Employee, overrides = load()): Person {
  const o = overrides[e.id];
  return {
    id: e.id,
    name: e.name,
    business_unit: e.business_unit,
    role: e.role,
    expertise_tags: o?.expertise_tags ?? e.expertise_tags,
    speaking_intent: o?.speaking_intent ?? "unknown",
    ng_themes: o?.ng_themes ?? [],
    past_talk_count: e.past_talk_count,
    last_talk_date: e.last_talk_date,
    reviewed: !!o?.reviewed,
    edited_fields: o?.edited_fields ?? [],
  };
}

export function getPerson(id: string): Person | undefined {
  const e = employeeById(id);
  return e ? personOf(e) : undefined;
}

export function allPeople(): Person[] {
  const o = load();
  return employees().map((e) => personOf(e, o));
}

// ---------------------------------------------------------------------------
// 直す
// ---------------------------------------------------------------------------
export type PersonPatch = Partial<Pick<Person, "expertise_tags" | "speaking_intent" | "ng_themes">>;

const cleanList = (xs: unknown, max: number, len: number): string[] | null => {
  if (!Array.isArray(xs)) return null;
  const out = [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];
  if (out.length > max || out.some((x) => x.length > len)) return null;
  return out;
};

/** 画面で人が直す。直した項目は確認済みになる */
export function editPerson(id: string, patch: PersonPatch): { ok: true; person: Person } | { ok: false; error: string } {
  const e = employeeById(id);
  if (!e) return { ok: false, error: `社員 ${id} は存在しません` };
  const all = load();
  const prev = all[id] ?? { edited_fields: [], reviewed: false, updated_at: "" };
  const next: PersonOverride = { ...prev, edited_fields: [...prev.edited_fields] };
  const mark = (f: PersonField) => {
    if (!next.edited_fields.includes(f)) next.edited_fields.push(f);
  };
  if (patch.expertise_tags !== undefined) {
    const tags = cleanList(patch.expertise_tags, 10, 30);
    if (!tags || tags.length === 0) return { ok: false, error: "得意分野は1〜10個、それぞれ30文字までにしてください" };
    next.expertise_tags = tags;
    mark("expertise_tags");
  }
  if (patch.speaking_intent !== undefined) {
    if (!["available", "hold", "unknown"].includes(patch.speaking_intent)) return { ok: false, error: "登壇の意向が正しくありません" };
    next.speaking_intent = patch.speaking_intent;
    mark("speaking_intent");
  }
  if (patch.ng_themes !== undefined) {
    const ng = cleanList(patch.ng_themes, 10, 40);
    if (!ng) return { ok: false, error: "NGのテーマは10個まで、それぞれ40文字までにしてください" };
    next.ng_themes = ng;
    mark("ng_themes");
  }
  next.reviewed = true;
  next.updated_at = new Date().toISOString();
  all[id] = next;
  save(all);
  return { ok: true, person: personOf(e, all) };
}

/**
 * Agent やほかの自動処理（例：予定の計算）が人の情報を書くときの入口。
 * 人が直した項目（edited_fields）は上書きしない。上書きしなかった項目を返す。
 */
export function applyAutoPersonUpdate(id: string, patch: PersonPatch): { kept: PersonField[] } {
  const all = load();
  const prev = all[id] ?? { edited_fields: [], reviewed: false, updated_at: "" };
  const kept: PersonField[] = [];
  const next: PersonOverride = { ...prev };
  for (const f of Object.keys(patch) as PersonField[]) {
    if (prev.edited_fields.includes(f)) {
      kept.push(f);
      continue;
    }
    (next as unknown as Record<string, unknown>)[f] = patch[f];
  }
  next.updated_at = new Date().toISOString();
  all[id] = next;
  save(all);
  return { kept };
}

// ---------------------------------------------------------------------------
// Agent が候補を出すときに使う（コードで判定）
// ---------------------------------------------------------------------------
const norm = (s: string) => s.replace(/[\s　・／/、,「」『』（）()]/g, "").toLowerCase();

/** テーマ案などの文が、その人のNGのテーマに当たるか。当たったNGのテーマを返す */
export function ngHits(text: string, ngThemes: string[]): string[] {
  const t = norm(text);
  return ngThemes.filter((ng) => norm(ng) && t.includes(norm(ng)));
}

/** Agent への最初のメッセージに足す「人の情報（技術広報が確認済み）」。意向かNGのテーマがある人だけ */
export function peopleNotesForAgent(): string {
  const lines = allPeople()
    .filter((p) => p.speaking_intent !== "unknown" || p.ng_themes.length)
    .map((p) => `- ${p.id} ${p.name}：登壇の意向「${INTENT_LABEL[p.speaking_intent]}」${p.ng_themes.length ? `／NGのテーマ「${p.ng_themes.join("」「")}」` : ""}`);
  return lines.length ? `\n\n# 人の情報（技術広報が確認済み）\n${lines.join("\n")}` : "";
}

// ---------------------------------------------------------------------------
// 画面用
// ---------------------------------------------------------------------------
export interface PersonRow {
  id: string;
  name: string;
  business_unit: string;
  expertise_tags: string[];
  unpublished_cards: number;
  speaking_intent: SpeakingIntent;
  reviewed: boolean;
  past_talk_count: number;
  /** 登壇経験の印（lib/talkTag.ts。候補と同じ言い方） */
  talk_tag: TalkTag;
  /** デモ用の本人（DEMO_PERSON=on のときだけ true。一覧の一番上に固定し「本人（デモ）」の印） */
  is_demo: boolean;
  /** 最近の活動の日付（並び順に使う。なければ null） */
  latest_activity_date: string | null;
}

/**
 * 人の一覧（社員全員）。並び順はコードで決める：
 * デモ用の本人を一番上に固定 → 未発信のネタが多い順 → 最近の活動が新しい順 → 名前
 */
export function peopleRows(): PersonRow[] {
  const cards = loadCards();
  const latest = new Map<string, string>();
  for (const a of activities()) if (a.author_id && (latest.get(a.author_id) ?? "") < a.date) latest.set(a.author_id, a.date);
  const rows = allPeople().map((p) => ({
    id: p.id,
    name: p.name,
    business_unit: p.business_unit,
    expertise_tags: p.expertise_tags,
    unpublished_cards: cards.filter((c) => c.employee_id === p.id && c.publication_status === "unpublished").length,
    speaking_intent: p.speaking_intent,
    reviewed: p.reviewed,
    past_talk_count: p.past_talk_count,
    talk_tag: talkTag(p),
    is_demo: isDemoPerson(p.id),
    latest_activity_date: latest.get(p.id) ?? null,
  }));
  return rows.sort(
    (a, b) =>
      Number(b.is_demo) - Number(a.is_demo) ||
      b.unpublished_cards - a.unpublished_cards ||
      (b.latest_activity_date ?? "").localeCompare(a.latest_activity_date ?? "") ||
      a.name.localeCompare(b.name, "ja"),
  );
}

export interface PersonDetail {
  /** 登壇経験の印（候補と同じ言い方） */
  talk_tag: TalkTag;
  person: Person;
  card_ids: string[];
  recent_activities: Array<{ id: string; type: string; date: string; title: string; url: string | null }>;
  published: Array<{ id: string; date: string; genre: string; title: string }>;
  /** 直近のブログ（新しい順、すべて。画面は3件まで出し、残りは「すべて見る」）。lib/blogView.ts */
  blogs?: BlogItem[];
}

export function personDetail(id: string): PersonDetail | undefined {
  const person = getPerson(id);
  if (!person) return undefined;
  const acts = activities()
    .filter((a) => a.author_id === id)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5)
    .map((a) => ({ id: a.id, type: a.type, date: a.date, title: a.title, url: (a as { url?: string | null }).url ?? null }));
  const pubs = published()
    .filter((p) => p.author_id === id)
    .sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
    .slice(0, 5)
    .map((p) => ({ id: p.id, date: p.published_at.slice(0, 10), genre: p.genre, title: p.title }));
  return {
    person,
    card_ids: loadCards()
      .filter((c) => c.employee_id === id)
      .map((c) => c.card_id),
    recent_activities: acts,
    published: pubs,
    talk_tag: talkTag(person),
    blogs: blogsOf(id),
  };
}
