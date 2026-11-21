// 受信箱に貼られた X（DM・リプライ）の会話から、依頼の項目を読み取る。
// - 読むのは Agent（小さな1回の呼び出し）：イベント名・日程・形式・テーマ・指名・主催者の名前と、その根拠になった会話の一節（引用）
// - 確かめるのはコード：引用が本当に会話の中にあるか、日程が1日に決まっているか、指名が社員データに実在するか
// - 日程が決まっていないときは「日程の手がかり」（「2月か3月」「春ごろ」など、会話にある言い回しそのまま）も読む。
//   本当に会話にあるかはコードで確かめ、なければ捨てる。期間への変換と空いていそうな日は lib/dateHint.ts（コード）
// - 確かめられなかった項目は「未定」にして、注意点に書く。推測で埋めない
// X には手を出さない（読みにいかない・返信しない）。ここで扱うのは人が貼った文だけ。
import { getClient } from "./anthropic";
import { findDates } from "./dates";
import { resolveNominee, type NomineeReading } from "./nominee";
import { chooseModels, recordUsage } from "./usage";

/** 読み取る項目（指名は別に扱う） */
export type IntakeField = "event_name" | "date" | "format" | "theme" | "organizer";
export const INTAKE_LABEL: Record<IntakeField, string> = {
  event_name: "イベント名",
  date: "日程",
  format: "形式",
  theme: "テーマ",
  organizer: "主催者の名前",
};
export const INTAKE_FIELDS = Object.keys(INTAKE_LABEL) as IntakeField[];

/** Agent が返す形。値と、その根拠になった会話の一節（書かれたとおり） */
export type Quoted = { value: string | null; quote: string | null };
export type RawIntake = Record<IntakeField, Quoted> & { nominee: Quoted; date_hint?: Quoted | null };

/** コードで確かめたあとの読み取り結果 */
export interface IntakeReading {
  event_name: string | null;
  /** YYYY-MM-DD。1日に決まっていなければ null */
  date: string | null;
  format: string | null;
  theme: string | null;
  organizer: string | null;
  /** 日程が決まっていないときの時期の手がかり（会話にある言い回しそのまま。会話の中にあることを確かめ済み）。日程が決まっている・手がかりがなければ null */
  date_hint?: string | null;
  /** 未定（会話の中で決まっていない、または読み取りを確かめられなかった）の項目 */
  undecided: IntakeField[];
  /** 未定にした理由（項目ごと、使う人向けの文） */
  reasons: Partial<Record<IntakeField, string>>;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 引用の照合用：全角半角・空白の違いは無視する */
const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
const inText = (text: string, quote: string | null) => !!quote && norm(quote).length >= 2 && norm(text).includes(norm(quote));

/** 日程が決まっていないことを表す言葉（引用にこれがあれば日付があっても未定） */
const NOT_FIXED = /調整中|未定|候補|どちらか|いずれか|か[、,]?\s*\d|あたり|ごろ|頃|予定です?か|仮/;

/**
 * 日程の確かめ（コード）。引用が会話にあり、日付がちょうど1つで、期間でも候補でもないときだけ決まったとみなす。
 * 年が書かれていなければ、受信日より後になる年にする（受信日の30日前より前なら翌年）。
 */
export function checkDate(text: string, quote: string | null, receivedAt: string): { date: string | null; reason: string | null } {
  if (!quote) return { date: null, reason: "会話の中に日程が書かれていません" };
  if (!inText(text, quote)) return { date: null, reason: "読み取った日程が会話の中に見つからないため、確かめられませんでした" };
  const ds = findDates(quote.normalize("NFKC"));
  if (ds.length === 0) return { date: null, reason: `「${quote.slice(0, 30)}」からは日付が1日に決まりません` };
  if (ds.length > 1 || ds[0].start.m !== ds[0].end.m || ds[0].start.d !== ds[0].end.d || NOT_FIXED.test(quote)) {
    return { date: null, reason: `日程は「${quote.slice(0, 30)}」で、まだ1日に決まっていません` };
  }
  const d = ds[0];
  const yearM = d.text.match(/^(\d{4})/);
  const received = receivedAt.slice(0, 10);
  const make = (y: number) => `${y}-${pad(d.start.m)}-${pad(d.start.d)}`;
  if (yearM) return { date: make(Number(yearM[1])), reason: null };
  const recvYear = Number(received.slice(0, 4));
  const limit = new Date(Date.parse(received) - 30 * 86_400_000).toISOString().slice(0, 10);
  const same = make(recvYear);
  return { date: same < limit ? make(recvYear + 1) : same, reason: null };
}

/** 文に曜日（「（木）」「(Thu)」など）が書いてあれば、その日付の曜日と合っているか。書いていなければ true */
export function weekdayMatches(text: string, date: string): boolean {
  const t = text.normalize("NFKC");
  const ja = t.match(/[(（]\s*([月火水木金土日])\s*(?:曜日?)?\s*[)）]/);
  const en = t.match(/[(（]\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s*[)）]/i);
  if (!ja && !en) return true;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (ja) return "日月火水木金土"[dow] === ja[1];
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][dow] === en![1].toLowerCase();
}

/** 日程の手がかりの確かめ（コード）：言い回しそのものが会話の中にあるときだけ使う（20字まで）。日程が決まっていれば使わない */
export function checkDateHint(text: string, hint: Quoted | null | undefined, date: string | null): string | null {
  const v = hint?.value?.trim();
  if (date || !v || v.length > 20 || !inText(text, v)) return null;
  return v;
}

/** Agent の読み取りを確かめる（コード）。指名は社員データで照合する */
export function checkIntake(text: string, raw: RawIntake, receivedAt: string): { intake: IntakeReading; nominee: NomineeReading } {
  const reasons: Partial<Record<IntakeField, string>> = {};
  const plain = (f: Exclude<IntakeField, "date">): string | null => {
    const q = raw[f];
    const v = q?.value?.trim() || null;
    if (!v) {
      reasons[f] = "会話の中でまだ決まっていません";
      return null;
    }
    if (!inText(text, q.quote)) {
      reasons[f] = "読み取った内容が会話の中に見つからないため、確かめられませんでした";
      return null;
    }
    return v.slice(0, 120);
  };
  const event_name = plain("event_name");
  const format = plain("format");
  const theme = plain("theme");
  const organizer = plain("organizer");
  let d = raw.date?.value ? checkDate(text, raw.date.quote, receivedAt) : { date: null as string | null, reason: "会話の中でまだ決まっていません" as string | null };
  let hint = checkDateHint(text, raw.date_hint, d.date);
  // Agent が日程を「手がかり」に回しても、手がかりがちょうど1日（期間・候補・「ごろ」でない）で、曜日が書いてあれば合っているなら、決まっているとする
  // （会話に指示の文などが混ざると、Agent が言い切らずに手がかりに回すことがあるため。判定はコード）
  if (!d.date && hint) {
    const fromHint = checkDate(text, hint, receivedAt);
    if (fromHint.date && weekdayMatches(hint, fromHint.date)) {
      d = fromHint;
      hint = null;
    }
  }
  if (d.reason) reasons.date = d.reason;
  const intake: IntakeReading = {
    event_name,
    date: d.date,
    date_hint: hint,
    format,
    theme,
    organizer,
    undecided: INTAKE_FIELDS.filter((f) => reasons[f]),
    reasons,
  };

  // 指名：引用が会話になければ読み取れなかったとして指名なし。あれば社員データで照合（既存の照合をそのまま使う）
  const nv = raw.nominee?.value?.trim() || null;
  const nominee: NomineeReading =
    nv && !inText(text, raw.nominee.quote)
      ? { name: nv, employee_id: null, note: `指名「${nv}」を会話の中で確かめられなかったため、指名なしとして扱いました。会話を確認してください` }
      : resolveNominee(nv);
  return { intake, nominee };
}

/** 未定の項目を、候補の注意点に書く1文にする（なければ null） */
export function undecidedNote(intake: IntakeReading | null | undefined): string | null {
  if (!intake || intake.undecided.length === 0) return null;
  const labels = intake.undecided.map((f) => INTAKE_LABEL[f]);
  return `${labels.join("・")}は未定です（会話の中で決まっていないか確かめられないため、推測で埋めていません）。主催者に確認してください`;
}

/** Agent に渡す依頼文：読み取った項目を先頭に足し、元の会話をそのまま続ける */
export function intakeHeader(intake: IntakeReading, nominee: NomineeReading | null): string {
  const v = (f: IntakeField, s: string | null) => (s ? s : `未定（${intake.reasons[f] ?? "決まっていません"}）`);
  return [
    "【会話から読み取った項目（本文と照合済み。未定の項目は推測で埋めないこと）】",
    `イベント名：${v("event_name", intake.event_name)}`,
    `日程：${v("date", intake.date)}${!intake.date && intake.date_hint ? `（時期の手がかり：「${intake.date_hint}」）` : ""}`,
    `形式：${v("format", intake.format)}`,
    `テーマ：${v("theme", intake.theme)}`,
    `主催者の名前：${v("organizer", intake.organizer)}`,
    `指名：${nominee?.employee_id ? nominee.name : nominee?.name ? `${nominee.name}（社員として確かめられず、指名なしとして扱う）` : "なし"}`,
    "【元の会話】",
  ].join("\n");
}

const QUOTED = {
  type: "object",
  properties: { value: { type: ["string", "null"] }, quote: { type: ["string", "null"] } },
  required: ["value", "quote"],
  additionalProperties: false,
};
const SCHEMA = {
  type: "object",
  properties: {
    event_name: QUOTED,
    date: QUOTED,
    format: QUOTED,
    theme: QUOTED,
    organizer: QUOTED,
    nominee: QUOTED,
    date_hint: QUOTED,
  },
  required: ["event_name", "date", "format", "theme", "organizer", "nominee", "date_hint"],
  additionalProperties: false,
};

/** Agent が会話を読む関数（テストでは偽物に差し替える）。古い形（指名の名前だけ）を返してもよい */
export type IntakeExtractor = (text: string, runId: string) => Promise<RawIntake | string | null>;

/** 本物の読み取り（Agent への小さな1回の呼び出し） */
export const extractIntakeWithAgent: IntakeExtractor = async (text, runId) => {
  const { loop: model } = chooseModels();
  const res = await getClient().messages.create({
    model,
    max_tokens: 3000,
    system: `社外から届いた登壇の依頼を読みます。X（DM・リプライ）の会話がそのまま貼られていることが多く、複数のメッセージが続いたり、くだけた言葉だったり、日程や形式があとから決まったりします。
次の7項目について、会話の中で「決まっている」値と、その根拠になった一節（quote）を返してください。
- event_name：イベント名
- date：開催日（YYYY-MM-DD）。quote には日付を含む一節をそのまま入れる
- format：形式（LT・トーク・パネルなど、分数が分かれば添える）
- theme：話してほしいテーマ
- organizer：主催者側の人の名前（書かれたとおり。名前がなければ表示名やアカウント名）
- nominee：登壇者として名前を挙げて指名している LayerX 社内の人（1人。主催者や依頼元の人は含めない）
- date_hint：開催日が1日に決まっていないときだけ、時期の手がかりになる言い回し（「2月か3月」「春ごろ」「年明けあたり」など）。value には会話にある言い回しをそのまま（短く、言い換えない）、quote にはそれを含む一節。開催日が決まっている、または手がかりがなければ value も quote も null
決まり：
- quote は会話からそのまま抜き出す（言い換えない・要約しない・つなぎ合わせない）
- あとのメッセージで変わったり決まったりしたら、いちばん新しい内容を使う
- 決まっていない（調整中・候補が複数・「春ごろ」など）、書かれていない項目は value も quote も null。推測で埋めない`,
    messages: [{ role: "user", content: text }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
  });
  recordUsage(runId, "inbox_extract", res.model, res.usage);
  if (res.stop_reason === "refusal") return null;
  const out = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  return JSON.parse(out) as RawIntake;
};
