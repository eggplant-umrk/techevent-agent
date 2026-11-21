// Googleフォームの回答（スプレッドシートからCSVで書き出したもの）を、アンケートの回答に変換する層（v0.4）。
// - 1行目は質問文、1列目はタイムスタンプ。回答のidはスプレッドシートの行番号から振る（例：ev019-r12）
// - 列の意味は、まず質問文のキーワードでコードが決める。決まらない列だけ Agent に聞く（任意）。読み取れない列は無視して画面に出す
// - 個人を特定できる列（メール・名前など）は取り込み時に捨てる。保存も Agent への受け渡しもしない
// - Google への API 連携は作らない（CSV を選ぶか貼るだけ）
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { getClient } from "./anthropic";
import { employeeById, events, type SurveyAnswer } from "./data";
import { chooseModels, recordUsage } from "./usage";

export type ColumnRole = "timestamp" | "talk" | "rating" | "comment" | "want_next" | "role" | "personal" | "unread";

export interface ColumnInfo {
  index: number;
  header: string;
  role: ColumnRole;
  /** keyword＝質問文のキーワードでコードが決めた／agent＝Agent に聞いた／none＝決まらなかった */
  by: "keyword" | "agent" | "none";
  /** 満足度の列（role=rating）のとき：overall＝イベント全体の満足度（登壇者に結びつけない）／talk＝登壇ごとの点数（その登壇の参考にだけ使う）。
   *  アンケートの形はまだ分からないので、「登壇・発表・セッション」を指す質問文でなければ全体の満足度として扱う */
  scope?: "overall" | "talk";
}

/** 登壇ごとの点数を聞いている質問文（例：「この登壇の満足度」「発表の評価」） */
const TALK_RATING = /(登壇|発表|セッション|講演|トーク|この話).{0,12}(満足|評価|点数|点)|(満足|評価|点数).{0,12}(登壇|発表|セッション|講演|トーク)/;
export const ratingScope = (header: string): "overall" | "talk" => (TALK_RATING.test(header) ? "talk" : "overall");

export interface SurveyImport {
  event_id: string;
  source: "sample" | "upload";
  imported_at: string;
  rows: number;
  columns: ColumnInfo[];
  answers: SurveyAnswer[];
  /** どの登壇への回答か分からなかった行（スプレッドシートの行番号） */
  unmatched_rows: number[];
  /** 登壇のタイトル（「どの登壇か」の列の「名前「タイトル」」から、コードで取り出す）。登壇者 id → タイトル */
  talk_titles?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// CSV（RFC 4180：ダブルクォート・改行を含むセル・BOM）
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------------------
// 列の意味（質問文のキーワード）。個人情報を先に見る
// ---------------------------------------------------------------------------
const KEYWORDS: Array<[ColumnRole, RegExp]> = [
  ["personal", /メール|e-?mail|お名前|氏名|名前|フルネーム|電話|会社名|勤務先|住所|連絡先/i],
  ["timestamp", /タイムスタンプ|timestamp|回答日時/i],
  ["talk", /どの登壇|どの発表|どのセッション|登壇者|セッション名|発表者/],
  ["rating", /満足度|満足|評価|点数|おすすめ度/],
  ["want_next", /次に聞きたい|今後聞きたい|聞きたいテーマ|リクエスト|取り上げてほしい/],
  ["comment", /感想|ご意見|自由|コメント|よかった点|改善/],
  ["role", /職種|お仕事|職業|役職|ご職業/],
];

export function detectColumns(headers: string[]): ColumnInfo[] {
  // 満足度は「全体」と「登壇ごと」を1列ずつまで持てる
  const taken = new Set<string>();
  return headers.map((h, index) => {
    const hit = KEYWORDS.find(([, re]) => re.test(h));
    if (!hit) return { index, header: h, role: "unread" as const, by: "none" as const };
    const [role] = hit;
    const scope = role === "rating" ? ratingScope(h) : undefined;
    const key = scope ? `rating:${scope}` : role;
    if (role !== "personal" && taken.has(key)) return { index, header: h, role: "unread" as const, by: "none" as const };
    taken.add(key);
    return scope ? { index, header: h, role, by: "keyword" as const, scope } : { index, header: h, role, by: "keyword" as const };
  });
}

/** 個人情報らしい文字（メール・電話番号）を伏せる。原文を直してよいのはここだけ */
export function scrubPersonal(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "［メールアドレスを削除］")
    .replace(/0\d{1,4}-?\d{1,4}-?\d{3,4}/g, "［電話番号を削除］");
}

const ROLE_VALUES: ColumnRole[] = ["talk", "rating", "comment", "want_next", "role", "personal", "unread"];

/** 決まらない列の意味を Agent に聞く。渡すのは質問文と、個人情報を伏せた見本の値（3件・40文字まで）だけ */
export type ColumnAsker = (cols: Array<{ index: number; header: string; samples: string[] }>) => Promise<Array<{ index: number; role: ColumnRole }>>;

export function claudeColumnAsker(runId: string): ColumnAsker {
  return async (cols) => {
    const client = getClient();
    const { loop: model } = chooseModels();
    const res = await client.messages.create({
      model,
      max_tokens: 2000,
      system:
        "Googleフォームのアンケートを書き出したCSVの列の意味を決め、submit_columns を1回呼んで提出します。各列を次のどれかにしてください：talk（どの登壇への回答か）、rating（満足度の数字）、comment（感想・自由記述）、want_next（次に聞きたいテーマ）、role（職種）、personal（メール・名前など個人を特定できる情報）、unread（どれでもない・分からない）。迷ったら unread。",
      tools: [
        {
          name: "submit_columns",
          description: "列の意味を提出する",
          input_schema: {
            type: "object",
            properties: {
              columns: {
                type: "array",
                items: {
                  type: "object",
                  properties: { index: { type: "integer" }, role: { type: "string", enum: ROLE_VALUES } },
                  required: ["index", "role"],
                  additionalProperties: false,
                },
              },
            },
            required: ["columns"],
            additionalProperties: false,
          },
        },
      ],
      messages: [{ role: "user", content: cols.map((c) => `列${c.index}：「${c.header}」 見本：${c.samples.map((x) => `「${x}」`).join("、") || "（空）"}`).join("\n") }],
    });
    recordUsage(runId, "survey", res.model, res.usage);
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    return ((use?.input as { columns?: Array<{ index: number; role: ColumnRole }> })?.columns ?? []).filter((c) => ROLE_VALUES.includes(c.role));
  };
}

// ---------------------------------------------------------------------------
// 変換
// ---------------------------------------------------------------------------
function speakerOf(value: string, speakerIds: string[]): string | null {
  const v = value.replace(/\s/g, "");
  for (const id of speakerIds) {
    const name = employeeById(id)?.name ?? "";
    const family = name.split(/\s/)[0];
    if (name && v.includes(name.replace(/\s/g, ""))) return id;
    if (family && v.startsWith(family)) return id;
  }
  return null;
}

const ratingOf = (v: string) => {
  const m = v.match(/[1-5１-５]/);
  return m ? Number(String.fromCharCode(m[0].charCodeAt(0) > 255 ? m[0].charCodeAt(0) - 0xfee0 : m[0].charCodeAt(0))) : null;
};

export async function importSurveyCsv(
  eventId: string,
  text: string,
  opts: { source: SurveyImport["source"]; asker?: ColumnAsker | null } = { source: "upload" },
): Promise<{ ok: true; data: SurveyImport } | { ok: false; error: string }> {
  const ev = events().find((e) => e.id === eventId);
  if (!ev) return { ok: false, error: "そのイベントは見つかりません" };
  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, error: "CSVに回答の行がありません（1行目が質問文、2行目から回答の形にしてください）" };
  const [headers, ...body] = table;
  let columns = detectColumns(headers);

  const unknown = columns.filter((c) => c.role === "unread");
  if (unknown.length && opts.asker) {
    const answers = await opts.asker(
      unknown.map((c) => ({
        index: c.index,
        header: c.header,
        samples: body
          .map((r) => scrubPersonal((r[c.index] ?? "").trim()).slice(0, 40))
          .filter(Boolean)
          .slice(0, 3),
      })),
    );
    const taken = new Set(columns.filter((c) => c.role !== "unread" && c.role !== "personal").map((c) => c.role));
    columns = columns.map((c) => {
      if (c.role !== "unread") return c;
      const a = answers.find((x) => x.index === c.index);
      if (!a || a.role === "unread") return c;
      if (a.role !== "personal" && taken.has(a.role) && a.role !== "rating") return c;
      if (a.role === "rating") {
        const scope = ratingScope(c.header);
        if (columns.some((x) => x.role === "rating" && (x.scope ?? "overall") === scope)) return c;
        return { ...c, role: a.role, by: "agent" as const, scope };
      }
      taken.add(a.role);
      return { ...c, role: a.role, by: "agent" as const };
    });
  }

  const data = convert(eventId, ev.speaker_ids, headers.length, body, columns, opts.source);
  if (!columns.some((c) => c.role === "rating" || c.role === "comment")) return { ok: false, error: "満足度の列も感想の列も見つかりませんでした。質問文を確かめてください" };
  return { ok: true, data };
}

/** 列の意味が決まった表を回答に変換する（同期）。個人情報の列はここで読まない（コピーもしない） */
function convert(eventId: string, speakerIds: string[], _width: number, body: string[][], columns: ColumnInfo[], source: SurveyImport["source"]): SurveyImport {
  const col = (role: ColumnRole) => columns.find((c) => c.role === role)?.index;
  // 満足度：scope のない古い取り込みは全体の満足度として扱う
  const iRating = columns.find((c) => c.role === "rating" && (c.scope ?? "overall") === "overall")?.index;
  const iTalkRating = columns.find((c) => c.role === "rating" && c.scope === "talk")?.index;
  const [iComment, iTalk, iWant, iRole] = [col("comment"), col("talk"), col("want_next"), col("role")];
  const answers: SurveyAnswer[] = [];
  const unmatched: number[] = [];
  const titles: Record<string, string> = {};
  body.forEach((r, i) => {
    const rowNo = i + 2; // スプレッドシートの行番号（1行目は質問文）
    const speaker = iTalk !== undefined ? speakerOf(r[iTalk] ?? "", speakerIds) : speakerIds.length === 1 ? speakerIds[0] : null;
    if (!speaker) return void unmatched.push(rowNo);
    const title = iTalk !== undefined ? (r[iTalk] ?? "").match(/[「『]([^」』]{2,120})[」』]/)?.[1]?.trim() : undefined;
    if (title && !titles[speaker]) titles[speaker] = title;
    // 自由記述の中のメール・電話番号は伏せる（原文を直すのはここだけ）
    answers.push({
      id: `${eventId}-r${rowNo}`,
      event_id: eventId,
      talk_speaker_id: speaker,
      rating: iRating !== undefined ? ratingOf(r[iRating] ?? "") : null,
      talk_rating: iTalkRating !== undefined ? ratingOf(r[iTalkRating] ?? "") : null,
      comment: iComment !== undefined ? scrubPersonal((r[iComment] ?? "").trim()) : "",
      want_next: iWant !== undefined && (r[iWant] ?? "").trim() ? scrubPersonal(r[iWant].trim()) : null,
      role: iRole !== undefined && (r[iRole] ?? "").trim() ? r[iRole].trim() : null,
    });
  });
  return { event_id: eventId, source, imported_at: new Date().toISOString(), rows: body.length, columns, answers, unmatched_rows: unmatched, talk_titles: titles };
}

// ---------------------------------------------------------------------------
// 保存と読み込み
// ---------------------------------------------------------------------------
const SAMPLE_DIR = () => path.join(process.cwd(), "data", "surveys");
/** 画面から取り込んだもの（個人情報の列は捨てたあと）。テストでは SURVEY_IMPORT_DIR で別の場所に向ける */
const IMPORT_DIR = () => process.env.SURVEY_IMPORT_DIR || path.join(process.cwd(), "data", "survey_imports");

export function saveImport(data: SurveyImport) {
  fs.mkdirSync(IMPORT_DIR(), { recursive: true });
  fs.writeFileSync(path.join(IMPORT_DIR(), `${data.event_id}.json`), JSON.stringify(data, null, 2) + "\n", "utf-8");
}

const cache = new Map<string, { mtime: number; data: SurveyImport }>();

/** そのイベントの回答。画面から取り込んだものがあればそれ、なければ架空データの CSV（キーワードだけで読む・APIなし） */
export function loadImport(eventId: string): SurveyImport | null {
  const uploaded = path.join(IMPORT_DIR(), `${eventId}.json`);
  if (fs.existsSync(uploaded)) return JSON.parse(fs.readFileSync(uploaded, "utf-8")) as SurveyImport;
  const sample = path.join(SAMPLE_DIR(), `${eventId}.csv`);
  const ev = events().find((e) => e.id === eventId);
  if (!ev || !fs.existsSync(sample)) return null;
  const mtime = fs.statSync(sample).mtimeMs;
  const hit = cache.get(eventId);
  if (hit && hit.mtime === mtime) return hit.data;
  const [headers, ...body] = parseCsv(fs.readFileSync(sample, "utf-8"));
  const data = { ...convert(eventId, ev.speaker_ids, headers.length, body, detectColumns(headers), "sample"), imported_at: "" };
  cache.set(eventId, { mtime, data });
  return data;
}

/** すべてのイベントの回答 */
export function surveys(): SurveyAnswer[] {
  return events().flatMap((e) => loadImport(e.id)?.answers ?? []);
}
