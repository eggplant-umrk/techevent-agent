// 評価（docs/evals.md）の AI の判定。コードで測れないもの（声かけ文の自然さなど）だけに使う。
// - 観点ごとに1回、1つの「はい／いいえ」の問いだけを聞く（観点をまとめて点数を付けさせない）
// - 答えは yes・no・unknown（分からない）。根拠として、見せた文の一節をそのまま引用させる
// - コードが確かめる：引用が本当に見せた文の中にあるか。なければ「分からない」にする（根拠のない合否を採らない）
// 呼び出しは差し替えられる（テストでは偽物、本番は lib/anthropic.ts の client）。API を使うのは本番だけ。
import type { CheckResult, EvalCase, EvalOutput, JudgeAspect, Verdict } from "../../lib/evalTypes";
import { candidateTexts } from "./checks";

export interface JudgeAnswer {
  verdict: "yes" | "no" | "unknown";
  /** 判断の根拠にした一節（見せた文からそのまま） */
  quote: string | null;
  reason: string;
}
/** 1つの問いを AI に聞く関数（system・user を渡して、JSON の文字列を返す） */
export type JudgeCall = (system: string, user: string) => Promise<string>;

export const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["yes", "no", "unknown"] },
    quote: { type: ["string", "null"] },
    reason: { type: "string" },
  },
  required: ["verdict", "quote", "reason"],
  additionalProperties: false,
};

export const JUDGE_SYSTEM = `あなたは、技術広報を手伝う AI が書いた文を点検する審査員です。問いは1つだけです。次の決まりで答えてください。
- 答えは verdict に yes（はい）・no（いいえ）・unknown（分からない）のどれか
- 見せた文だけで判断する。見せた文から判断できない・根拠が足りないときは、推測せずに unknown にする
- quote には、判断の根拠にした一節を、見せた文からそのまま抜き出す（言い換えない）。unknown のときは null
- reason には、そう判断した理由を1文で書く
- 問いに関係のないこと（ほかの良し悪し）は判断に入れない`;

/** 観点に見せる文。なければ null（判定できない） */
export function judgeTarget(target: JudgeAspect["target"], o: EvalOutput): string | null {
  if (target === "outreach") return o.draft?.message?.trim() || null;
  if (target === "organizer_reply") return o.draft?.organizer_reply?.trim() || null;
  const t = candidateTexts(o).join("\n");
  return t.trim() || null;
}

const flat = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

/** AI の答えを、評価の判定（pass・fail・unknown）にする。引用が見せた文になければ unknown */
export function toVerdict(answer: JudgeAnswer | null, shown: string): { verdict: Verdict; detail: string } {
  if (!answer || !["yes", "no", "unknown"].includes(answer.verdict)) return { verdict: "unknown", detail: "答えの形が読めない" };
  if (answer.verdict === "unknown") return { verdict: "unknown", detail: `分からない：${answer.reason}` };
  const q = answer.quote?.trim();
  if (!q || flat(q).length < 4 || !flat(shown).includes(flat(q))) return { verdict: "unknown", detail: `根拠の引用が、見せた文の中にない（${answer.verdict}：${answer.reason}）` };
  return { verdict: answer.verdict === "yes" ? "pass" : "fail", detail: `${answer.reason}（「${q.slice(0, 40)}」）` };
}

/** 1件のケースの、AI に判定させる観点をすべて判定する（観点ごとに1回の呼び出し） */
export async function judgeCase(c: EvalCase, o: EvalOutput, call: JudgeCall): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const j of c.judge ?? []) {
    const name = `AI：${j.aspect}`;
    const shown = judgeTarget(j.target, o);
    if (!shown) {
      out.push({ name, verdict: "unknown", detail: "見せる文がない（下書き・候補が作られていない）" });
      continue;
    }
    try {
      const raw = await call(JUDGE_SYSTEM, `# 問い\n${j.question}\n\n# 見せる文\n${shown}`);
      out.push({ name, ...toVerdict(JSON.parse(raw) as JudgeAnswer, shown) });
    } catch (e) {
      out.push({ name, verdict: "unknown", detail: `判定できなかった：${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return out;
}

/** 本番の呼び出し（API を使う）。金額は purpose "judge" で記録する */
export async function realJudgeCall(runId: string): Promise<JudgeCall> {
  const { getClient } = await import("../../lib/anthropic");
  const { chooseModels, recordUsage } = await import("../../lib/usage");
  return async (system, user) => {
    const res = await getClient().messages.create({
      model: chooseModels().loop,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    });
    recordUsage(runId, "judge", res.model, res.usage);
    return res.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
  };
}
