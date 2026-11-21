// Read-only access to data/*.json (plus append for learnings / usage).
// data/README.md holds the evaluation answer key and is never read here.
import fs from "node:fs";
import path from "node:path";
import { dataFile } from "./dataSource";

const DATA_DIR = path.join(process.cwd(), "data");

const ALLOWED = new Set([
  "employees.json",
  "activities.json",
  "events.json",
  "requests.json",
  "application_rules.json",
  "published.json",
  "schedules.json",
  "cards.json",
  "external_events.json",
  "usage.json",
]);

function readJson<T>(name: string, fallback?: T): T {
  if (!ALLOWED.has(name)) throw new Error(`not an agent data file: ${name}`);
  const file = dataFile(name);
  if (!fs.existsSync(file) && fallback !== undefined) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function writeJson(name: string, value: unknown) {
  if (!ALLOWED.has(name)) throw new Error(`not an agent data file: ${name}`);
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(value, null, 2) + "\n", "utf-8");
}

export interface Employee {
  id: string;
  name: string;
  business_unit: string;
  role: string;
  expertise_tags: string[];
  past_talk_count: number;
  last_talk_date: string | null;
  /** 架空データに決め打ちで書いてあった忙しさ（1〜5）。使わない（11/21〜）：忙しさは予定から計算する（lib/busyness.ts） */
  workload?: number;
}

export interface Activity {
  id: string;
  type: "slack_post" | "github_pr" | "design_doc" | "weekly_report";
  author_id: string;
  date: string;
  title: string;
  body: string;
  channel: string | null;
  repo: string | null;
  /** Link to the original page (GitHub source only). */
  url?: string;
}

export interface EventRecord {
  id: string;
  title: string;
  series: string;
  date: string;
  venue: string;
  capacity: number;
  applications: number;
  attendees: number;
  speaker_ids: string[];
}

export interface SpeakingRequest {
  id: string;
  pattern?: string;
  received_at?: string;
  requester?: { organization: string; contact_name: string; channel: string };
  event?: {
    title: string;
    date: string;
    format: string;
    duration_min: number;
    audience: string;
    venue: string;
    online: boolean;
  };
  theme?: string | null;
  nominated_employee_id?: string | null;
  reference?: { kind: string; title: string; url: string } | null;
  reply_deadline?: string;
  message: string;
}

export interface Published {
  id: string;
  title: string;
  url: string;
  tags: string[];
  author_id: string;
  business_unit: string;
  published_at: string;
  genre: string;
  target_reader: string;
  team: string;
}

export interface Schedule {
  employee_id: string;
  from: string;
  to: string;
  kind: string;
  note: string;
}

export interface UsageEntry {
  at: string;
  run_id: string;
  purpose: "loop" | "draft" | "alternative_pitch" | "notebook" | "blog_ideas" | "judge" | "inbox_extract" | "survey";
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}

export const employees = () => readJson<Employee[]>("employees.json");
export const activities = () => readJson<Activity[]>("activities.json");
export const events = () => readJson<EventRecord[]>("events.json");
export const published = () => readJson<Published[]>("published.json");
export const schedules = () => readJson<Schedule[]>("schedules.json");
export const usage = () => readJson<UsageEntry[]>("usage.json", []);

/** イベント後のアンケートの1回答（1行＝1つの登壇への回答）。Googleフォームの CSV から lib/surveyCsv.ts が作る。個人情報の列は入らない */
export interface SurveyAnswer {
  id: string;
  event_id: string;
  talk_speaker_id: string;
  /** 満足度1〜5。読み取れなければ null */
  rating: number | null;
  comment: string;
  want_next: string | null;
  role: string | null;
}

/** Requests with demo-only fields (note_for_demo) removed. This is the only way requests reach the agent or the browser. */
export function requests(): SpeakingRequest[] {
  const raw = readJson<Array<Record<string, unknown>>>("requests.json");
  return raw.map((r) => {
    const { note_for_demo: _omit, ...rest } = r;
    return rest as unknown as SpeakingRequest;
  });
}

export function appendUsage(entry: UsageEntry) {
  writeJson("usage.json", [...usage(), entry]);
}

export function employeeById(id: string): Employee | undefined {
  return employees().find((e) => e.id === id);
}
