// "Heavy" work on HEAVY_MODEL (Fable 5.2 by default): the outreach draft and the
// alternative-speaker pitch. If the heavy call fails or is refused, redo it on Opus 5.5.
import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "./anthropic";
import { HEAVY_FALLBACK_MODEL } from "./config";
import { activities, employeeById, type SpeakingRequest } from "./data";
import { chooseModels, recordUsage } from "./usage";
import type { UsageEntry } from "./data";
import { internalTermProblems, PLAIN_TEXT_RULE } from "./plainText";

export interface HeavyResult<T> {
  value: T;
  model: string;
  fellBack: boolean;
  cost_usd: number;
}

async function callHeavy(
  runId: string,
  purpose: UsageEntry["purpose"],
  system: string,
  user: string,
  schema?: Record<string, unknown>,
): Promise<{ text: string; model: string; fellBack: boolean; cost: number }> {
  const client = getClient();
  const { heavy } = chooseModels();
  const output_config = {
    effort: "medium" as const,
    ...(schema ? { format: { type: "json_schema" as const, schema } } : {}),
  };
  let cost = 0;

  const textOf = (content: Array<{ type: string }>) =>
    content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

  try {
    // Server-side refusal fallback is on (beta); the client-side retry below covers errors.
    const res = await client.beta.messages.create({
      model: heavy,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      messages: [{ role: "user", content: user }],
      output_config,
    });
    cost += recordUsage(runId, purpose, res.model, res.usage).cost_usd;
    if (res.stop_reason !== "refusal" && res.stop_reason !== "max_tokens") {
      const text = textOf(res.content);
      if (text) return { text, model: res.model, fellBack: false, cost };
    }
  } catch (err) {
    if (!(err instanceof Anthropic.APIError)) throw err;
    if (heavy === HEAVY_FALLBACK_MODEL) throw err;
  }

  if (heavy === HEAVY_FALLBACK_MODEL) throw new Error("重い処理の呼び出しに失敗しました");
  const res = await client.messages.create({
    model: HEAVY_FALLBACK_MODEL,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config,
  });
  cost += recordUsage(runId, purpose, res.model, res.usage).cost_usd;
  if (res.stop_reason === "refusal") throw new Error("下書きを作れませんでした（拒否）");
  return { text: textOf(res.content), model: res.model, fellBack: true, cost };
}

/** 依頼を日本語の見出しで渡す（英語の項目名をモデルに見せないため）。 */
function requestText(r: SpeakingRequest): string {
  const ev = r.event;
  return [
    `依頼元：${r.requester?.organization ?? "不明"}`,
    ev ? `イベント：${ev.title}（${ev.date}、${ev.format}${ev.duration_min}分、${ev.online ? "オンライン" : ev.venue}）` : "イベント：不明",
    ev ? `聴衆：${ev.audience}` : "",
    `テーマ：${r.theme ?? "お任せ"}`,
    `依頼文：${r.message}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 1回作って、使う人向けの文に内部の言葉が入っていたら、そのことを伝えて1回だけ作り直す。
 * それでも入っていればエラーにする（そのまま見せない）。
 */
async function generateChecked<T>(
  make: (extra: string) => Promise<{ value: T; model: string; fellBack: boolean; cost: number }>,
  textsOf: (v: T) => Array<{ where: string; text: string }>,
): Promise<HeavyResult<T>> {
  let r = await make("");
  let problems = internalTermProblems(textsOf(r.value));
  let cost = r.cost;
  if (problems.length) {
    r = await make(`\n\n# 前回の下書きの問題\n${problems.join("\n")}\n内部の項目名やidを使わず、普通の言葉で書き直してください。`);
    cost += r.cost;
    problems = internalTermProblems(textsOf(r.value));
    if (problems.length) throw new Error(`下書きに内部の言葉が残りました：${problems.join(" / ")}`);
  }
  return { value: r.value, model: r.model, fellBack: r.fellBack, cost_usd: cost };
}

export interface OutreachDraft {
  subject: string;
  message: string;
  lt_outline: Array<{ minutes: number; heading: string; points: string[] }>;
  tips_for_pr: string[];
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    message: { type: "string" },
    lt_outline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          minutes: { type: "number" },
          heading: { type: "string" },
          points: { type: "array", items: { type: "string" } },
        },
        required: ["minutes", "heading", "points"],
        additionalProperties: false,
      },
    },
    tips_for_pr: { type: "array", items: { type: "string" } },
  },
  required: ["subject", "message", "lt_outline", "tips_for_pr"],
  additionalProperties: false,
};

/** draft_outreach(employee_id, theme): outreach message + talk outline. Never sent; shown for copy only. */
export async function draftOutreach(
  runId: string,
  request: SpeakingRequest,
  candidate: { employee_id: string; theme: string; reason: string; evidence_activity_ids: string[] },
): Promise<HeavyResult<OutreachDraft>> {
  const emp = employeeById(candidate.employee_id);
  if (!emp) throw new Error(`社員 ${candidate.employee_id} は見つかりません`);
  const evidence = activities()
    .filter((a) => candidate.evidence_activity_ids.includes(a.id))
    .map((a) => `- ${a.date} ${a.title}：${a.body}`)
    .join("\n");

  const system = `あなたはLayerXの技術広報の文章を手伝います。社内メンバーに登壇をお願いする声かけ文（Slack DM想定）と、発表の構成案を下書きします。送るのは技術広報本人なので、そのまま貼れる自然な文にしてください。
- 相手の取り組みを具体的に挙げ、「なぜあなたにお願いしたいか」が伝わるようにする
- 断りやすさも残す（忙しければ断ってよい、共同登壇や資料づくりの手伝いもできる、など）
- 登壇経験が少ない人には、準備の負担が小さいことを伝える
- 構成案は持ち時間に収まるように分単位で割り振る
- tips_for_pr には、技術広報が声をかける前に確認しておくとよいことを2〜3個
- ${PLAIN_TEXT_RULE}`;

  const user = `# 依頼
${requestText(request)}

# 声をかける相手
${emp.name}（${emp.business_unit}／${emp.role}）／登壇${emp.past_talk_count}回／忙しさ${emp.workload}

# テーマ案
${candidate.theme}

# 選んだ理由
${candidate.reason}

# 根拠の取り組み
${evidence || "（なし）"}`;

  return generateChecked(
    async (extra) => {
      const r = await callHeavy(runId, "draft", system, user + extra, DRAFT_SCHEMA);
      return { value: JSON.parse(r.text) as OutreachDraft, model: r.model, fellBack: r.fellBack, cost: r.cost };
    },
    (d) => [
      { where: "件名", text: d.subject },
      { where: "声かけ文", text: d.message },
      ...d.lt_outline.flatMap((s) => [{ where: "構成案", text: s.heading }, ...s.points.map((p) => ({ where: "構成案", text: p }))]),
      ...d.tips_for_pr.map((t) => ({ where: "声をかける前に", text: t })),
    ],
  );
}

/** For named-speaker requests: why to propose someone other than (or alongside) the nominee. */
export async function alternativePitch(
  runId: string,
  request: SpeakingRequest,
  nomineeAssessment: string | null,
  alternatives: Array<{ employee_id: string; theme: string; reason: string }>,
): Promise<HeavyResult<string>> {
  const nominee = request.nominated_employee_id ? employeeById(request.nominated_employee_id) : undefined;
  const alts = alternatives
    .map((a) => {
      const e = employeeById(a.employee_id);
      return `- ${e?.name ?? a.employee_id}（${e?.business_unit}／登壇${e?.past_talk_count}回）：${a.theme}。${a.reason}`;
    })
    .join("\n");
  const system = `あなたはLayerXの技術広報を手伝います。社外から特定のメンバーを指名した登壇依頼が来ています。Agentの調査で、ほかにより合うメンバーがいると分かりました。
技術広報が「依頼元にどう返すか」「指名された本人にどう相談するか」を決められるように、代わりの人を推す理由を短くまとめてください。
- 依頼元の期待（なぜその人を指名したか）を尊重する
- 代わりの人を推す理由は取り組みの中身で示す
- 共同登壇や、指名された人がモデレーターに回る案など、角が立たない選択肢も1つ出す
- 300〜500字、見出しなし、箇条書き可
- ${PLAIN_TEXT_RULE}`;
  const user = `# 依頼
${requestText(request)}
指名のきっかけ：${request.reference ? `${request.reference.title}` : "不明"}

# 指名された人
${nominee ? `${nominee.name}（${nominee.business_unit}／${nominee.role}／登壇${nominee.past_talk_count}回／忙しさ${nominee.workload}）` : "不明"}
確認結果：${nomineeAssessment ?? "（なし）"}

# 代わりに推す人
${alts}`;
  return generateChecked(
    async (extra) => {
      const r = await callHeavy(runId, "alternative_pitch", system, user + extra);
      return { value: r.text, model: r.model, fellBack: r.fellBack, cost: r.cost };
    },
    (t) => [{ where: "代わりの人を推す理由", text: t }],
  );
}
