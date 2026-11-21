// デモ用：開発者本人を、架空の会社の31人目として入れる（DEMO_PERSON=on のときだけ）。
//   - 本人のプロフィールと活動は data/sources/github/（scripts/import_github.ts の出力。本物の公開リポジトリ）をそのまま使う。
//     架空の活動は作らない。id だけ架空の社員とぶつからないように振り直す（社員 e001 → e031、活動 act001 → act201）
//   - 登壇回数は0（「初登壇」の印が付く）
//   - 予定は CALENDAR_ICS_URL（iCal）から読む。設定がなければ「予定は不明」（lib/busyness.ts）
//   - 本人のカードと更新状態は data/sources/demo-person/ に分けて保存し、架空の30人のカード（data/cards.json）は触らない
// 既定（未設定）では入らない。評価（scripts/eval.ts）は DEMO_PERSON を消して、今までどおり30人で動く。
// DATA_SOURCE=github（本人だけに切り替える）とは同時に使えない。
import fs from "node:fs";
import path from "node:path";
import type { Activity, Employee } from "./data";
import { dataSource } from "./dataSource";

export const DEMO_ID = "e031";
const ACT_OFFSET = 200;
const GITHUB_DIR = path.join(process.cwd(), "data", "sources", "github");
export const DEMO_DIR = path.join(process.cwd(), "data", "sources", "demo-person");

export function demoPersonOn(): boolean {
  const v = (process.env.DEMO_PERSON ?? "").trim().toLowerCase();
  const on = v === "on" || v === "1" || v === "true";
  if (on && dataSource()) throw new Error("DEMO_PERSON=on と DATA_SOURCE=github は同時に使えません（どちらか一方にしてください）");
  return on;
}

export const isDemoPerson = (id: string) => demoPersonOn() && id === DEMO_ID;

function readGithub<T>(name: string): T {
  const file = path.join(GITHUB_DIR, name);
  if (!fs.existsSync(file)) throw new Error(`DEMO_PERSON=on には ${path.relative(process.cwd(), file)} が必要です（npm run import:github で作る）`);
  return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

/** 本物の活動の id を、架空の活動（act001〜act120）とぶつからない id に振り直す。 */
export function demoActivityId(githubId: string): string {
  const n = Number(githubId.replace(/^act/, ""));
  return `act${String(n + ACT_OFFSET).padStart(3, "0")}`;
}

export function demoEmployee(): Employee {
  const [me] = readGithub<Employee[]>("employees.json");
  const { workload: _unused, ...rest } = me;
  return {
    ...rest,
    id: DEMO_ID,
    business_unit: "開発者本人（デモ）",
    role: me.role,
    past_talk_count: 0,
    last_talk_date: null,
  };
}

export function demoActivities(): Activity[] {
  return readGithub<Activity[]>("activities.json").map((a) => ({ ...a, id: demoActivityId(a.id), author_id: DEMO_ID }));
}

// ---- 本人の分だけ別のファイルに保存する（架空の30人のファイルは、中身が変わったときだけ書く） ----

export function demoFile(name: "cards.json" | "notebook_state.json"): string {
  return path.join(DEMO_DIR, name);
}

export function writeIfChanged(file: string, value: unknown) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (fs.existsSync(file) && fs.readFileSync(file, "utf-8") === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf-8");
}
