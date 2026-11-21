// 「ネタ帳を更新」の前処理（コード）。AI に渡す前に、数える・絞る・照らし合わせるをコードで済ませる。
// - 前回より新しい活動だけ：社員ごとに「読んだ（または落とした）活動の id」を記録し、それ以外を新しい活動とする
// - AI に渡す前に落とす：同じ本文の重複、極端に短いもの、定型文、マージされていない PR、説明がほとんどない PR、
//   ボットのコミット、typo や依存の更新だけのコミット。落とした件数と理由を記録する
// - 1回に渡す件数と文字数に上限（新しい順に詰め、超える分は次回に回す。次回に回した分は「読んだ」にしない）
// - 流す前の金額の見積もり（上限は .env の NOTEBOOK_BUDGET_USD、なければ $1）
// - 保存の前の重複カードの検査（同じ人の同じ取り組み）
import fs from "node:fs";
import type { Card, CardInput } from "./cards";
import type { Activity } from "./data";
import { dataFile } from "./dataSource";
import { DEMO_ID, demoFile, demoPersonOn } from "./demoPerson";
import { PRICING } from "./pricing";

// ---------------------------------------------------------------------------
// 設定
// ---------------------------------------------------------------------------
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
export function prepConfig() {
  return {
    /** 1回に1人分として渡す活動の件数の上限 */
    maxItems: num(process.env.NOTEBOOK_MAX_ITEMS, 60),
    /** 1回に1人分として渡す活動の文字数（タイトル＋本文）の上限 */
    maxChars: num(process.env.NOTEBOOK_MAX_CHARS, 20000),
    /** 1件の本文を渡す長さの上限（長い PR の説明などは先頭だけ） */
    bodyChars: num(process.env.NOTEBOOK_BODY_CHARS, 400),
    /** 「ネタ帳を更新」1回の金額の上限（USD） */
    budgetUsd: num(process.env.NOTEBOOK_BUDGET_USD, 1),
  };
}

// ---------------------------------------------------------------------------
// コードで落とす
// ---------------------------------------------------------------------------
export type DropReason = "duplicate" | "too_short" | "boilerplate" | "unmerged_pr" | "thin_pr" | "bot" | "trivial_commit";
export const DROP_LABEL: Record<DropReason, string> = {
  duplicate: "同じ本文の重複",
  too_short: "極端に短い",
  boilerplate: "定型文（特になし など）",
  unmerged_pr: "マージされていない PR",
  thin_pr: "説明がほとんどない PR",
  bot: "ボットのコミット",
  trivial_commit: "typo・依存の更新・書式だけのコミット",
};

const MIN_CHARS = 10;
const BOILERPLATE = /^(特になし|特にない|とくになし|なし|無し|n\/a|-|ー|—|wip|tmp|test)[。.!！]?$/i;
const BOT = /^(merge (pull request|branch|remote-tracking)|bump |chore\(deps|build\(deps|dependabot|renovate|.*\[bot\]|github-actions|auto-?generated)/i;
const TRIVIAL = /typo|誤字|lint|prettier|eslint|フォーマット|^format|formatting|依存(ライブラリ)?の?(更新|アップデート)|update dependenc|dependencies|\bdeps\b|bump|package(-lock)?\.json|yarn\.lock|pnpm-lock|^readme(を)?(更新|修正)?$|^update readme|空白|インデント|whitespace/i;

/** 空白と句読点をならした本文（重複の判定用）。数字は残す（数字だけ違う進み具合の報告は別の活動として渡す） */
const normalize = (s: string) => s.replace(/\s+/g, "").replace(/[。、.,!！?？]/g, "");

/** GitHub のコミットのまとめ・単独のコミットから、コミットのメッセージを取り出す */
function commitMessages(a: Activity): string[] | null {
  const url = (a as Activity & { url?: string }).url ?? "";
  const bundle = a.body.match(/^この日のコミット\d+件：([\s\S]*)$/);
  if (bundle) return bundle[1].split(" ／ ").map((s) => s.trim()).filter(Boolean);
  if (url.includes("/commit/")) return [a.title.replace(/^[^：]*：/, "")];
  return null;
}

/** 1件を見て、落とす理由（なければ null）と、渡すときの本文（まとめから些細なコミットを抜いたもの）を返す */
export function classify(a: Activity): { reason: DropReason | null; body: string } {
  const body = a.body.trim();
  const title = a.title.replace(/^[^：]*：/, "").trim();
  if (BOILERPLATE.test(body) || (!body && BOILERPLATE.test(title))) return { reason: "boilerplate", body };
  if (a.type === "github_pr") {
    const url = (a as Activity & { url?: string }).url ?? "";
    if (url.includes("/pull/")) {
      if (/^レビュー中/.test(body)) return { reason: "unmerged_pr", body };
      const desc = body.replace(/^マージ \d{4}-\d{2}-\d{2}( ／ )?/, "").replace(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( ／ )?`), "").trim();
      if (desc.length < 20) return { reason: "thin_pr", body };
    }
    const msgs = commitMessages(a);
    if (msgs) {
      const kept = msgs.filter((m) => !BOT.test(m) && !TRIVIAL.test(m));
      if (!kept.length) return { reason: msgs.every((m) => BOT.test(m)) ? "bot" : "trivial_commit", body };
      if (kept.length < msgs.length && /^この日のコミット/.test(body)) return { reason: null, body: `この日のコミット${msgs.length}件のうち${kept.length}件：${kept.join(" ／ ")}` };
    } else if (!url && (BOT.test(title) || TRIVIAL.test(title))) {
      // 架空データの PR（URL なし）：タイトルが typo・依存の更新だけのもの
      return { reason: BOT.test(title) ? "bot" : "trivial_commit", body };
    }
  }
  if (body.replace(/[。、.,!！?？\s]/g, "").length < MIN_CHARS) return { reason: "too_short", body };
  return { reason: null, body };
}

export interface Dropped {
  id: string;
  reason: DropReason;
}

/** 新しい活動を、渡すものと落とすものに分ける（古い順に見て、重複は最初の1件を残す） */
export function filterActivities(acts: Activity[], seenBodies: Set<string> = new Set()): { kept: Activity[]; dropped: Dropped[] } {
  const kept: Activity[] = [];
  const dropped: Dropped[] = [];
  for (const a of [...acts].sort((x, y) => (x.date === y.date ? x.id.localeCompare(y.id) : x.date < y.date ? -1 : 1))) {
    const c = classify(a);
    if (c.reason) {
      dropped.push({ id: a.id, reason: c.reason });
      continue;
    }
    const key = normalize(`${a.title.replace(/^[^：]*：/, "")}｜${c.body}`);
    const keyBody = normalize(c.body);
    if (seenBodies.has(key) || seenBodies.has(keyBody)) {
      dropped.push({ id: a.id, reason: "duplicate" });
      continue;
    }
    seenBodies.add(key);
    seenBodies.add(keyBody);
    kept.push({ ...a, body: c.body });
  }
  return { kept, dropped };
}

export const countReasons = (d: Dropped[]) =>
  d.reduce<Partial<Record<DropReason, number>>>((m, x) => ({ ...m, [x.reason]: (m[x.reason] ?? 0) + 1 }), {});

// ---------------------------------------------------------------------------
// 上限（新しい順に詰め、超える分は次回に回す）
// ---------------------------------------------------------------------------
export const activityChars = (a: Activity, bodyChars: number) => a.title.length + Math.min(a.body.length, bodyChars) + 40;

export function capActivities(kept: Activity[], cfg = prepConfig()): { send: Activity[]; deferred: Activity[] } {
  const newestFirst = [...kept].sort((x, y) => (x.date === y.date ? y.id.localeCompare(x.id) : x.date < y.date ? 1 : -1));
  const send: Activity[] = [];
  const deferred: Activity[] = [];
  let chars = 0;
  for (const a of newestFirst) {
    const c = activityChars(a, cfg.bodyChars);
    if (send.length < cfg.maxItems && chars + c <= cfg.maxChars) {
      send.push(a.body.length > cfg.bodyChars ? { ...a, body: a.body.slice(0, cfg.bodyChars) + "…" } : a);
      chars += c;
    } else deferred.push(a);
  }
  // Agent には古い順に見せる
  send.sort((x, y) => (x.date === y.date ? x.id.localeCompare(y.id) : x.date < y.date ? -1 : 1));
  return { send, deferred };
}

// ---------------------------------------------------------------------------
// どこまで読んだか（社員ごとの、読んだ・落とした活動の id）
// ---------------------------------------------------------------------------
export interface Progress {
  processed: string[];
  updated_at: string;
  last: { sent: number; dropped: Partial<Record<DropReason, number>>; deferred: number } | null;
}
type ProgressFile = Record<string, Progress>;

const progressFile = (employeeId: string) =>
  demoPersonOn() && employeeId === DEMO_ID ? demoFile("notebook_progress.json") : dataFile("notebook_progress.json");

function readProgress(file: string): ProgressFile {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf-8")) as ProgressFile) : {};
}

/** 読んだ活動の id。記録がなければ、今までの notebook_state（日付）までを読んだものとして引き継ぐ */
export function processedIds(employeeId: string, acts: Activity[], legacyDate: string | undefined): Set<string> {
  const p = readProgress(progressFile(employeeId))[employeeId];
  if (p) return new Set(p.processed);
  return new Set(legacyDate ? acts.filter((a) => a.date <= legacyDate).map((a) => a.id) : []);
}

export function saveProgress(employeeId: string, processed: Set<string>, last: Progress["last"]) {
  const file = progressFile(employeeId);
  const all = readProgress(file);
  all[employeeId] = { processed: [...processed].sort(), updated_at: new Date().toISOString(), last };
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n", "utf-8");
}

/** 1人分の前処理：新しい活動 → コードで落とす → 上限で切る */
export function prepareEmployee(employeeId: string, allActs: Activity[], legacyDate: string | undefined, cfg = prepConfig()) {
  const own = allActs.filter((a) => a.author_id === employeeId);
  const processed = processedIds(employeeId, own, legacyDate);
  const fresh = own.filter((a) => !processed.has(a.id));
  // すでに読んだ活動の本文も、重複の判定には使う（前回渡したものと同じ話は渡さない）
  const seen = new Set<string>();
  for (const a of own.filter((x) => processed.has(x.id))) {
    seen.add(normalize(`${a.title.replace(/^[^：]*：/, "")}｜${a.body.trim()}`));
    seen.add(normalize(a.body.trim()));
  }
  const { kept, dropped } = filterActivities(fresh, seen);
  const { send, deferred } = capActivities(kept, cfg);
  return { total: own.length, alreadyRead: processed.size, fresh: fresh.length, send, dropped, deferred, processed };
}

// ---------------------------------------------------------------------------
// 金額の見積もり
// ---------------------------------------------------------------------------
/** 日本語と英語が混ざった文の、文字数からのトークン数の目安（本物の GitHub データの実測：4.2万字 ≒ 3.7万トークン） */
export const tokensOf = (chars: number) => Math.ceil(chars / 1.1);

/** 1人分の見積もり（USD）。出力は活動1件あたり45トークン＋固定300（実測から）。差し戻しの分は入れない */
export function estimateUsd(model: string, messageChars: number, items: number, systemChars: number, firstCall: boolean): number {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  const p = key ? PRICING[key] : PRICING["claude-fable-5-2"];
  const input = tokensOf(messageChars);
  const output = Math.min(8000, 300 + 45 * items);
  const system = tokensOf(systemChars);
  return (input * p.input + output * p.output + system * (firstCall ? p.cacheWrite : p.cacheRead)) / 1_000_000;
}

// ---------------------------------------------------------------------------
// 重複カードの検査（保存の前）
// ---------------------------------------------------------------------------
const bigrams = (s: string) => {
  const t = s.replace(/[\s「」『』（）()：:・、。,.！!？?／/〜~-]/g, "").toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2));
  return out;
};
export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const g of x) if (y.has(g)) inter++;
  return inter / Math.min(x.size, y.size);
}
export const SIMILAR = 0.6;

/** 新しく作ろうとしているカードが、同じ人の既存カードと同じ取り組みなら、その理由を返す（なければ null） */
export function duplicateCardProblem(input: CardInput, cards: Card[]): string | null {
  if (input.card_id) return null;
  const mine = cards.filter((c) => c.employee_id === input.employee_id);
  for (const c of mine) {
    const shared = (input.evidence_activity_ids ?? []).filter((id) => c.evidence_activity_ids.includes(id));
    if (shared.length) return `既存のカード ${c.card_id} と根拠が重なっています（${shared.join(", ")}）。同じ取り組みなら card_id: "${c.card_id}" を指定して更新してください`;
    const s = Math.max(...(input.themes ?? []).map((t) => similarity(t, c.themes[0] ?? "")), similarity(input.summary ?? "", c.summary));
    if (s >= SIMILAR) return `既存のカード ${c.card_id}「${c.themes[0]}」と同じ取り組みに見えます。同じなら card_id: "${c.card_id}" を指定して更新し、別の取り組みならテーマと要約で違いが分かるように書いてください`;
  }
  return null;
}
