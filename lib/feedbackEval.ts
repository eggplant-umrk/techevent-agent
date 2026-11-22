// 使われた結果（data/runtime/feedback.jsonl）→ 評価のケースの候補（lib/evalTypes.ts の EvalCase）への変換。
// - 依頼ごとに1件のケースにまとめる（その依頼に付いた「違う／直した／よい」をまとめて期待する動きにする）
// - 個人情報を落とす：メール・電話・郵便番号・住所の形、社員の実名以外の人名らしきもの（「◯◯さん」「山田 太郎さん」など）、
//   アカウント名（@…・URL の中の x.com/{名前} など）。全角半角は先にそろえてから（NFKC）落とす
// - 出したケースは人が確かめてからリポジトリに入れる（このファイルは書き出しまで。コミットはしない）
// 判定の名前（checks）は docs/evals.md の例の名前を使う。判定の登録（scripts/evals/checks.ts）ができたら、その名前に合わせる。
import type { EvalCase, EvalOutput, EvalPriority, JudgeAspect } from "./evalTypes";
import type { Feedback } from "./feedback";
import { activeFeedback, REASON_CODES } from "./feedback";

/** 変換に使う、その依頼のそのときの中身（読むのは呼ぶ側。ここはファイルを読まない） */
export interface FeedbackSource {
  /** 受信箱の依頼なら貼られた文。サンプルの依頼なら null */
  text: string | null;
  channel?: "manual" | "slack";
  received_at?: string | null;
  recorded?: EvalOutput | null;
}

// ---------------------------------------------------------------------------
// 個人情報を落とす
// ---------------------------------------------------------------------------
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 全角半角は先にそろえる（NFKC。「０９０－１２３４－５６７８」も「090-1234-5678」にしてから落とす）
const PHONE = /(?:\+81[-\s]?|(?<![\d-]))0\d{1,4}[-‐－−ー\s]?\d{1,4}[-‐－−ー\s]?\d{3,4}(?![\d-])/g;
/** 「03(1234)5678」の形の電話 */
const PHONE_PAREN = /(?<!\d)0\d{1,4}\s?\(\d{1,4}\)\s?\d{3,4}(?!\d)/g;
const POSTAL = /〒\s?\d{3}[-‐－−ー]?\d{4}|(?<![\d-])\d{3}[-‐－−]\d{4}(?![\d-])/g;
const ADDRESS = /(?:東京都|北海道|(?:京都|大阪)府|[一-龥]{2,3}県)[^\s、。,，()（）「」]{0,20}?[市区町村郡][^\s、。,，()（）「」]{0,30}/g;
const HANDLE = /(?<![A-Za-z0-9._%+-])@[A-Za-z0-9_]{2,30}/g;
/** 「◯◯さん」「◯◯様」など、敬称の付いた人名らしきもの（社員の実名は残す）。「山田 太郎さん」のように姓と名の間に空白があっても、姓ごと落とす */
const HONORIFIC = /([一-龥々ぁ-んァ-ヶー]{1,6}(?:\s[一-龥々ぁ-んァ-ヶー]{1,6})?|[A-Z][a-z]{1,15}(?:\s[A-Z][a-z]{1,15})?)\s?(さん|様|さま|氏|くん|君|ちゃん|先生)/g;
/** 「◯◯と申します」（「山田 太郎と申します」も姓ごと） */
const NAMED = /([一-龥々ぁ-んァ-ヶー]{1,6}(?:\s[一-龥々ぁ-んァ-ヶー]{1,6})?|[A-Z][a-z]{1,15}(?:\s[A-Z][a-z]{1,15})?)\s?(と申します|と言います)/g;
const URL_RE = /https?:\/\/[^\s<>"'()「」、。]+/g;
/** URL の道筋の1つ目がアカウント名のサイト（x.com/{名前} など） */
const ACCOUNT_HOSTS = new Set([
  "twitter.com", "x.com", "github.com", "gitlab.com", "instagram.com", "facebook.com", "threads.net", "tiktok.com",
  "qiita.com", "zenn.dev", "note.com", "speakerdeck.com", "slideshare.net", "medium.com", "dev.to", "youtube.com",
  "b.hatena.ne.jp", "profile.hatena.ne.jp", "atcoder.jp", "wantedly.com", "lapras.com", "mastodon.social",
]);
/** アカウント名の前に決まった言葉が入るサイト（linkedin.com/in/{名前} など） */
const ACCOUNT_PREFIX: Record<string, string[]> = {
  "linkedin.com": ["in", "pub"],
  "bsky.app": ["profile"],
  "connpass.com": ["user"],
  "atcoder.jp": ["users"],
  "wantedly.com": ["id"],
  "youtube.com": ["c", "user", "channel"],
  "facebook.com": ["people"],
};
/** サブドメインがアカウント名のサイト（{名前}.hatenablog.com など） */
const ACCOUNT_SUFFIX = ["hatenablog.com", "hatenablog.jp", "hateblo.jp", "hatenadiary.jp", "github.io", "substack.com", "medium.com", "tumblr.com", "blogspot.com", "fc2.com", "livedoor.blog", "bsky.social"];

/** URL の中のアカウント名を落とす（イベントのページなどの URL はそのまま） */
function scrubUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)./, "");
  const segs = u.pathname.split("/");
  const sub = ACCOUNT_SUFFIX.find((d) => host.endsWith(`.${d}`) && host !== `www.${d}`);
  let changed = false;
  if (sub) {
    u.hostname = `account.${sub}`;
    changed = true;
  }
  const prefixes = ACCOUNT_PREFIX[host] ?? [];
  // segs[0] は空（先頭の /）。決まった言葉のあとの1つ、なければ1つ目
  let i = prefixes.includes(segs[1] ?? "") ? 2 : ACCOUNT_HOSTS.has(host) ? 1 : -1;
  if (i > 0 && segs[i]) {
    segs[i] = segs[i].startsWith("@") ? "@account" : "account";
    u.pathname = segs.join("/");
    changed = true;
  }
  if (!changed) return url;
  u.search = "";
  u.hash = "";
  return `${u.toString()}（アカウント）`;
}

/** 社員の実名（姓名・姓・名・空白なし）を、残してよい名前の集まりにする */
export function employeeNameSet(names: string[]): Set<string> {
  const s = new Set<string>();
  for (const n of names) {
    const t = n.normalize("NFKC").trim();
    if (!t) continue;
    s.add(t);
    s.add(t.replace(/\s+/g, ""));
    for (const part of t.split(/\s+/)) if (part) s.add(part);
  }
  return s;
}

/** 文から個人情報を落とす（置きかえる）。社員の実名だけは残す。全角半角は先にそろえる（NFKC） */
export function scrubText(text: string, keepNames: Set<string>): string {
  const keep = (name: string) => keepNames.has(name) || keepNames.has(name.replace(/s+/g, ""));
  const person = (m: string, name: string, suffix: string) => (keep(name) ? m : `（名前）${suffix}`);
  return text
    .normalize("NFKC")
    .replace(URL_RE, scrubUrl)
    .replace(EMAIL, "（メール）")
    .replace(PHONE, "（電話）")
    .replace(PHONE_PAREN, "（電話）")
    .replace(POSTAL, "（郵便番号）")
    .replace(ADDRESS, "（住所）")
    .replace(HANDLE, "@（アカウント）")
    .replace(HONORIFIC, person)
    .replace(NAMED, person);
}

/** オブジェクトの中の文字列を、すべて落とす。主催者の名前（intake.organizer）は丸ごと落とす */
export function scrubDeep<T>(v: T, keepNames: Set<string>): T {
  const walk = (x: unknown, key?: string): unknown => {
    if (typeof x === "string") return key === "organizer" ? null : scrubText(x, keepNames);
    if (Array.isArray(x)) return x.map((y) => walk(y));
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y, k)]));
    return x;
  };
  return walk(v) as T;
}

// ---------------------------------------------------------------------------
// 依頼ごとのケースにする
// ---------------------------------------------------------------------------
const label = (fb: Feedback) => REASON_CODES[fb.target]?.[fb.reason_code] ?? fb.reason_code;

const JUDGE_Q: Record<string, string> = {
  wording: "そのまま送れる、自然で丁寧な言い回しか",
  factual_error: "会話と根拠にあることだけを書き、事実の誤りがないか",
  length: "長すぎず短すぎず、相手がすぐ読める長さか",
  other: "人が直さずにそのまま使えるか",
  good: "人が直さずにそのまま使えるか",
};

/** 不満の大きさ（docs/evals.md の4）：外に出る誤り・本人の活動ではない・違う日は 3、ほかは 2、言い回しや長さは 2 */
function painOf(fb: Feedback): 1 | 2 | 3 {
  if (fb.verdict === "good") return 2;
  if (fb.reason_code === "factual_error" || fb.reason_code === "not_own_activity") return 3;
  if (fb.target === "intake_field" && (fb.target_id === "date" || fb.target_id === "event_name")) return 3;
  return 2;
}

/** その依頼の「使われた結果」を、評価のケース1件にする。作れなければ null（理由つき） */
export function feedbackToCase(requestId: string, rows: Feedback[], src: FeedbackSource, keepNames: Set<string>): { case: EvalCase | null; skipped?: string } {
  // 取り消された「違う」は数えない（lib/feedback.ts の activeFeedback）
  rows = activeFeedback(rows);
  if (!rows.length) return { case: null, skipped: "使われた結果がない" };
  const checks = new Set<string>();
  const params: Record<string, unknown> = {};
  const judge: JudgeAspect[] = [];
  const expect: string[] = [];
  const expected: string[] = [];
  const unexpected: string[] = [];
  const intakeFix: Record<string, string> = {};
  let raise = false;
  let pain: 1 | 2 | 3 = 1;
  let edited = false;
  for (const fb of rows) {
    pain = Math.max(pain, painOf(fb)) as 1 | 2 | 3;
    if (fb.verdict !== "good") raise = true;
    if (fb.target === "candidate") {
      if (fb.verdict === "good") {
        expected.push(fb.target_id);
        expect.push(`${fb.target_id} が候補に入る（人がよいと付けた）`);
      } else {
        unexpected.push(fb.target_id);
        expect.push(`${fb.target_id} を候補に出さない（理由：${label(fb)}）`);
      }
    } else if (fb.target === "draft" || fb.target === "reply") {
      if (fb.verdict === "edited") edited = true;
      const target = fb.target === "draft" ? "outreach" : "organizer_reply";
      const what = fb.target === "draft" ? "声かけ文" : "主催者への返事";
      const q = JUDGE_Q[fb.reason_code] ?? JUDGE_Q.other;
      if (!judge.some((j) => j.target === target && j.question === q)) judge.push({ aspect: `${what}：${fb.verdict === "good" ? "そのまま使える" : label(fb)}`, question: q, target });
      expect.push(fb.verdict === "good" ? `${what}が直さずに使える` : `${what}を人が直さずに使える（${fb.verdict === "edited" ? "直された" : "違うと付けられた"}理由：${label(fb)}）`);
    } else if (fb.target === "intake_field") {
      if (fb.verdict !== "good" && fb.after) intakeFix[fb.target_id] = fb.after;
      expect.push(fb.verdict === "good" ? `読み取りの ${fb.target_id} が正しい` : `読み取りの ${fb.target_id} を正しく読む（理由：${label(fb)}）`);
    }
  }
  if (expected.length) {
    checks.add("expected_in_candidates");
    params.expected_ids = [...new Set(expected)];
  }
  if (unexpected.length) {
    checks.add("not_in_candidates");
    params.unexpected_ids = [...new Set(unexpected)];
  }
  if (Object.keys(intakeFix).length) {
    checks.add("intake_fields_match");
    params.intake_expected = scrubDeep(intakeFix, keepNames);
  }
  if (!checks.size && !judge.length) return { case: null, skipped: "判定にできる中身がない（読み取りが違うのに直した値がない、など）" };

  const notes = rows.map((r) => r.note).filter((n): n is string => !!n);
  const good = rows.find((r) => r.target === "candidate" && r.verdict === "good");
  const recorded: EvalOutput = {
    ...(src.recorded ?? {}),
    human: {
      approved_employee_id: good?.target_id ?? null,
      edited,
      note: notes.length ? notes.join(" / ") : null,
    },
    recorded_at: rows[rows.length - 1].at,
  };
  const priority: EvalPriority = { frequency: 2, pain };
  const c: EvalCase = {
    id: `usage-${requestId.replace(/[^\w.:-]/g, "_")}`,
    source: "usage",
    origin: { ref: requestId, recorded_at: rows[rows.length - 1].at, note: `使われた結果 ${rows.length}件（${rows.map((r) => r.id).join(", ")}）から作った候補。判定の名前は scripts/evals/checks.ts の登録に合わせて確かめること` },
    title: scrubText(`使われた結果：${expect[0]}`, keepNames).slice(0, 80),
    input: src.text !== null ? { kind: "inbox", text: scrubText(src.text, keepNames), ...(src.channel ? { channel: src.channel } : {}), ...(src.received_at ? { received_at: src.received_at } : {}) } : { kind: "request", request_id: requestId },
    expect: scrubText(expect.join("。"), keepNames),
    checks: [...checks],
    ...(Object.keys(params).length ? { params } : {}),
    ...(judge.length ? { judge } : {}),
    priority,
    allowed_failure_rate: 0,
    suite: raise ? "raise" : "keep",
    recorded: scrubDeep(recorded, keepNames),
  };
  // 直す前・直したあとの文は、ケースの中に入れない（人が確かめるときは feedback.jsonl を見る）
  return { case: c };
}
