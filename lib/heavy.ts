// "Heavy" work on HEAVY_MODEL (Fable 5.2 by default): the outreach draft and the
// alternative-speaker pitch. If the heavy call fails or is refused, redo it on Opus 5.5.
import Anthropic from "@anthropic-ai/sdk";
import { getClient } from "./anthropic";
import { HEAVY_FALLBACK_MODEL } from "./config";
import { activities, employeeById, employees, type SpeakingRequest } from "./data";
import { INTAKE_LABEL } from "./intake";
import { fallbackOrganizerReply, ORGANIZER_REPLY_MAX, organizerReplyProblems } from "./organizerReply";
import { chooseModels, recordUsage } from "./usage";
import type { UsageEntry } from "./data";
import { internalTermProblems, PLAIN_TEXT_RULE } from "./plainText";
import { busynessFor, busyText, loadCalendarIfConfigured } from "./busyness";

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
  const contact = r.requester?.contact_name || r.intake?.organizer || null;
  return [
    `依頼元：${r.requester?.organization || r.intake?.event_name || "不明"}${contact ? `（主催者・担当：${contact}）` : ""}`,
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
  /** 追加の検査（主催者への返事など）。作り直しても残ったら repair で直す（エラーにはしない） */
  extra?: { problems: (v: T) => string[]; repair: (v: T, problems: string[]) => T },
): Promise<HeavyResult<T>> {
  let r = await make("");
  let problems = internalTermProblems(textsOf(r.value));
  let extraProblems = extra?.problems(r.value) ?? [];
  let cost = r.cost;
  if (problems.length || extraProblems.length) {
    r = await make(
      `\n\n# 前回の下書きの問題\n${[...problems, ...extraProblems].join("\n")}\n内部の項目名やidを使わず、普通の言葉で書き直してください。`,
    );
    cost += r.cost;
    problems = internalTermProblems(textsOf(r.value));
    if (problems.length) throw new Error(`下書きに内部の言葉が残りました：${problems.join(" / ")}`);
    extraProblems = extra?.problems(r.value) ?? [];
  }
  const value = extra && extraProblems.length ? extra.repair(r.value, extraProblems) : r.value;
  return { value, model: r.model, fellBack: r.fellBack, cost_usd: cost };
}

export interface OutreachDraft {
  subject: string;
  message: string;
  lt_outline: Array<{ minutes: number; heading: string; points: string[] }>;
  tips_for_pr: string[];
  /** 主催者への返事（X で返す短い文。依頼 → 候補の承認のときだけ。送信しない） */
  organizer_reply?: string | null;
  /** 主催者への返事を検査で差し替えたときの説明（使う人向け） */
  organizer_reply_note?: string | null;
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

/** 依頼 → 候補の承認のとき：声かけ文に加えて、主催者への返事も同じ1回で作る */
const REQUEST_DRAFT_SCHEMA = {
  ...DRAFT_SCHEMA,
  properties: { ...DRAFT_SCHEMA.properties, organizer_reply: { type: "string" } },
  required: [...DRAFT_SCHEMA.required, "organizer_reply"],
};

/** draft_outreach(employee_id, theme): outreach message + talk outline. Never sent; shown for copy only. */
export async function draftOutreach(
  runId: string,
  request: SpeakingRequest,
  candidate: { employee_id: string; theme: string; reason: string; evidence_activity_ids: string[] },
): Promise<HeavyResult<OutreachDraft>> {
  await loadCalendarIfConfigured();
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
- organizer_reply には、依頼をくれた主催者に X（DM・リプライ）で返す短い文を書く
  - ${ORGANIZER_REPLY_MAX}字以内。くだけすぎない丁寧さで、X らしく短く（件名・署名なし）。主催者の名前が分かれば最初に呼びかける
  - 「弊社の〇〇が△△のお話でお力になれそうです」のように、誰がどんなテーマで話せそうかを伝える。社内の人には「さん」を付けない
  - 本人にはまだ確認していないので確約しない（「本人に確認して、あらためてご連絡します」）
  - 未定の項目（日程・形式など）があれば、教えてほしいと一言添える
  - 社内の評価に当たる情報は書かない：忙しさ・予定の埋まり具合・登壇回数や経験・アンケートの反応・ほかの候補や比較・社内の判断
- ${PLAIN_TEXT_RULE}`;

  const others = employees()
    .filter((e) => e.id !== emp.id)
    .map((e) => e.name);
  const undecided = (request.intake?.undecided ?? []).map((f) => INTAKE_LABEL[f]);

  const user = `# 依頼
${requestText(request)}
${undecided.length ? `未定の項目：${undecided.join("・")}\n` : ""}

# 声をかける相手
${emp.name}（${emp.business_unit}／${emp.role}）／登壇${emp.past_talk_count}回／${busyText(busynessFor(emp.id))}

# テーマ案
${candidate.theme}

# 選んだ理由
${candidate.reason}

# 根拠の取り組み
${evidence || "（なし）"}`;

  return generateChecked(
    async (extra) => {
      const r = await callHeavy(runId, "draft", system, user + extra, REQUEST_DRAFT_SCHEMA);
      return { value: JSON.parse(r.text) as OutreachDraft, model: r.model, fellBack: r.fellBack, cost: r.cost };
    },
    (d) => [
      { where: "件名", text: d.subject },
      { where: "声かけ文", text: d.message },
      ...d.lt_outline.flatMap((s) => [{ where: "構成案", text: s.heading }, ...s.points.map((p) => ({ where: "構成案", text: p }))]),
      ...d.tips_for_pr.map((t) => ({ where: "声をかける前に", text: t })),
    ],
    {
      problems: (d) => [
        ...internalTermProblems([{ where: "主催者への返事", text: d.organizer_reply ?? "" }]),
        ...organizerReplyProblems(d.organizer_reply ?? "", emp.name, others),
      ],
      repair: (d, problems) => ({
        ...d,
        organizer_reply: safeOrganizerReply(request, emp.name, candidate.theme, others),
        organizer_reply_note: `作った文に問題があったため、決まった形の文に差し替えました（${problems[0]}）`,
      }),
    },
  );
}

/** 主催者への返事の代わりの文。テーマを入れて検査に通らなければ、テーマなしにする */
function safeOrganizerReply(request: SpeakingRequest, name: string, theme: string, others: string[]): string {
  const base = {
    name,
    organizer: request.requester?.contact_name || request.intake?.organizer || null,
    eventName: request.event?.title ?? request.intake?.event_name ?? null,
    undecided: (request.intake?.undecided ?? []).map((f) => INTAKE_LABEL[f]),
  };
  const withTheme = fallbackOrganizerReply({ ...base, theme });
  if (organizerReplyProblems(withTheme, name, others).length === 0) return withTheme;
  return fallbackOrganizerReply({ ...base, theme: "" });
}

/**
 * カード → 出し先：本人に「このネタで出てみませんか」と声をかける下書き。
 * 仕組みは draftOutreach と同じ（重いモデル、内部の言葉があれば1回作り直す、失敗したら Opus）。中身だけ変える。
 */
export async function draftVenueOutreach(
  runId: string,
  card: { employee_id: string; summary: string; evidence_activity_ids: string[] },
  venue: {
    name: string;
    event_date: string | null;
    cfp_status: string;
    cfp_deadline: string | null;
    format: string[];
    location: string | null;
    theme: string;
    reason: string;
    cautions: string[];
  },
): Promise<HeavyResult<OutreachDraft>> {
  await loadCalendarIfConfigured();
  const emp = employeeById(card.employee_id);
  if (!emp) throw new Error(`社員 ${card.employee_id} は見つかりません`);
  const evidence = activities()
    .filter((a) => card.evidence_activity_ids.includes(a.id))
    .map((a) => `- ${a.date} ${a.title}：${a.body}`)
    .join("\n");

  const system = `あなたはLayerXの技術広報の文章を手伝います。社内メンバーの取り組みを見て「このネタで社外イベントに出てみませんか」と本人に声をかける文（Slack DM想定）と、発表の構成案を下書きします。送るのは技術広報本人なので、そのまま貼れる自然な文にしてください。
- 本人の取り組みを具体的に挙げ、「なぜこのイベントに合うと思ったか」が伝わるようにする
- 応募するのは本人。応募の締切と公式ページで確かめることを添える（締切が未確認なら、そう書く。推測で日付を書かない）
- 断りやすさも残す（忙しければ見送ってよい、応募文や資料づくりの手伝いもできる、など）
- 登壇経験が少ない人には、準備の負担が小さいことを伝える
- 構成案は、そのイベントの形式（持ち時間）に収まるように分単位で割り振る。持ち時間が分からなければ20分で組む
- tips_for_pr には、技術広報が声をかける前に確認しておくとよいことを2〜3個
- ${PLAIN_TEXT_RULE}`;

  const user = `# 出し先
${venue.name}
開催日：${venue.event_date ?? "未定（要確認）"}／場所：${venue.location ?? "未定"}
形式：${venue.format.join("／")}
応募の締切：${venue.cfp_deadline ?? (venue.cfp_status === "open" ? "公式で確認" : "未確認（公式で要確認）")}
注意点：${venue.cautions.join("／") || "なし"}

# 声をかける相手
${emp.name}（${emp.business_unit}／${emp.role}）／登壇${emp.past_talk_count}回／${busyText(busynessFor(emp.id))}

# 発表タイトル案
${venue.theme}

# このイベントをすすめる理由
${venue.reason}

# 取り組み（カードの要約）
${card.summary}

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
  await loadCalendarIfConfigured();
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
${nominee ? `${nominee.name}（${nominee.business_unit}／${nominee.role}／登壇${nominee.past_talk_count}回／${busyText(busynessFor(nominee.id))}）` : "不明"}
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
