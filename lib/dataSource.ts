// Which employees / activities the agent reads, and where the notebook is saved.
//   DATA_SOURCE unset (default) -> the fictional data in data/ (評価・?mock・受信箱は今までどおり)
//   DATA_SOURCE=github          -> data/sources/github/ (scripts/import_github.ts の出力)
//   DATA_SOURCE=stress          -> data/sources/stress/ (汚れた10倍の架空データ。scripts/gen_data.py の出力、試験用)
// Only employees.json and activities.json are switched. Events, requests, published and
// schedules stay the fictional ones. Cards and the notebook state are kept per source so the
// fictional notebook (data/cards.json) is never overwritten.
import path from "node:path";

const SOURCES = new Set(["github", "stress"]);

/** "" for the default fictional data, otherwise the source name. */
export function dataSource(): string {
  const s = (process.env.DATA_SOURCE ?? "").trim();
  if (!s || s === "default") return "";
  if (!SOURCES.has(s)) throw new Error(`DATA_SOURCE=${s} はありません（使えるのは github・stress。未設定なら架空データ）`);
  return s;
}

const DATA_DIR = path.join(process.cwd(), "data");

/** Directory for files that change with the source. */
export function sourceDir(): string {
  const s = dataSource();
  return s ? path.join(DATA_DIR, "sources", s) : DATA_DIR;
}

const SWITCHED = new Set(["employees.json", "activities.json", "cards.json", "notebook_state.json", "calendar.json"]);

/** Full path of a data file, following DATA_SOURCE for the switched files. */
export function dataFile(name: string): string {
  return path.join(SWITCHED.has(name) ? sourceDir() : DATA_DIR, name);
}
