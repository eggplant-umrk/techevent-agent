// 外部イベント（data/external_events.json）。ファイルを読むだけで、外部サイトにはアクセスしない。
// 締切の判定・必ず書く注意点はここ（コード）で決める。
import fs from "node:fs";
import { todayJst } from "./clock";
import path from "node:path";
import { schedules } from "./data";

export type CfpStatus = "open" | "closed" | "unknown";

export interface ExternalEvent {
  id: string;
  name: string;
  url: string;
  event_date: string | null;
  cfp_status: CfpStatus;
  cfp_deadline: string | null;
  cfp_url: string | null;
  format: string[];
  themes: string;
  audience: string | null;
  location: string | null;
  note: string | null;
  checked_at: string;
}

const FILE = path.join(process.cwd(), "data", "external_events.json");
const NEAR_DAYS = 14;

export function loadExternalEvents(): ExternalEvent[] {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, "utf-8")) as ExternalEvent[];
}

export function externalEventById(id: string): ExternalEvent | undefined {
  return loadExternalEvents().find((e) => e.id === id);
}

/** themes は「SRE/モニタリング/…」の形（配列で来ても扱う） */
export function themesOf(e: ExternalEvent): string[] {
  const t = e.themes as unknown;
  if (Array.isArray(t)) return t.map(String);
  return String(t ?? "")
    .split(/[\/／、,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 締切日（日本時間の日付 YYYY-MM-DD）。なければ null */
export function deadlineDate(e: ExternalEvent): string | null {
  if (!e.cfp_deadline) return null;
  const d = new Date(e.cfp_deadline);
  if (Number.isNaN(d.getTime())) return e.cfp_deadline.slice(0, 10);
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10); // JST
}

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** 締切済み：closed、または締切が今日より前 */
export function isClosed(e: ExternalEvent, today = todayJst()): boolean {
  if (e.cfp_status === "closed") return true;
  const dl = deadlineDate(e);
  return !!dl && dl < today;
}

const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

/**
 * 出し先を出すときに必ず付ける注意点（コードで決める）。
 * - unknown：締切は公式で要確認
 * - event_date が null：開催日は要確認（日付チェックの対象外）
 * - 締切が近い（14日以内）
 * - 本人の予定が開催日の前後3日に重なる
 */
export function requiredCautions(e: ExternalEvent, employeeId: string | null, today = todayJst()): string[] {
  const out: string[] = [];
  if (e.cfp_status === "unknown") out.push("締切は公式で要確認");
  if (!e.event_date) out.push("開催日は要確認");
  const dl = deadlineDate(e);
  if (dl && dl >= today && days(today, dl) <= NEAR_DAYS) out.push(`締切が近い（${md(dl)}まで、あと${days(today, dl)}日）`);
  if (employeeId && e.event_date) {
    const lo = new Date(Date.parse(e.event_date) - 3 * 86_400_000).toISOString().slice(0, 10);
    const hi = new Date(Date.parse(e.event_date) + 3 * 86_400_000).toISOString().slice(0, 10);
    const hit = schedules().find((s) => s.employee_id === employeeId && s.from <= hi && s.to >= lo);
    if (hit) out.push(`本人の予定が重なる（${hit.kind} ${md(hit.from)}〜${md(hit.to)}）`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ツール search_external_events
// ---------------------------------------------------------------------------
export function searchExternalEvents(input: { query?: string; from?: string; to?: string }) {
  const terms = (input.query ?? "")
    .split(/[\s　、,／/]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const all = loadExternalEvents();
  const inPeriod = (e: ExternalEvent) =>
    !e.event_date || ((!input.from || e.event_date >= input.from) && (!input.to || e.event_date <= input.to));
  const scored = all
    .filter(inPeriod)
    .map((e) => {
      const themes = themesOf(e).join(" ").toLowerCase();
      const hay = `${e.name} ${e.audience ?? ""} ${e.note ?? ""} ${e.format.join(" ")}`.toLowerCase();
      let score = terms.length ? 0 : 1;
      for (const t of terms) {
        if (themes.includes(t)) score += 3;
        else if (hay.includes(t)) score += 1;
      }
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return {
    total: all.length,
    hits: scored.length,
    note: "can_apply=false の締切済みのイベントは出し先にできません。cfp_status=unknown は締切を公式で要確認、event_date=null は開催日が未定です",
    results: scored.map(({ e, score }) => {
      const dl = deadlineDate(e);
      return {
        id: e.id,
        name: e.name,
        event_date: e.event_date,
        cfp_status: e.cfp_status,
        cfp_deadline: dl,
        days_left: dl ? days(todayJst(), dl) : null,
        can_apply: !isClosed(e),
        format: e.format,
        themes: themesOf(e),
        audience: e.audience,
        location: e.location,
        note: e.note ? (e.note.length > 160 ? e.note.slice(0, 160) + "…" : e.note) : null,
        score,
      };
    }),
  };
}
