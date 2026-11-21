// "ブログのネタを出す": pick 3 unpublished cards that would make good blog posts.
// One call, structured output. Only unpublished cards are offered; ブログ済み/登壇済み never appear.
import { randomUUID } from "node:crypto";
import { todayJst } from "./clock";
import { getClient } from "./anthropic";
import { loadCards, outreachSummary, type Card } from "./cards";
import { TRENDS } from "./config";
import { activities, employeeById } from "./data";
import { chooseModels, recordUsage, runUsd, totalUsd } from "./usage";
import { internalTerms, PLAIN_TEXT_RULE } from "./plainText";
import { busynessFor, busyText, loadCalendarIfConfigured } from "./busyness";

export interface BlogIdea {
  card_id: string;
  title: string;
  why_easy_to_blog: string;
  outline: string[];
}

const SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          card_id: { type: "string" },
          title: { type: "string" },
          why_easy_to_blog: { type: "string" },
          outline: { type: "array", items: { type: "string" } },
        },
        required: ["card_id", "title", "why_easy_to_blog", "outline"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
};

function describe(c: Card): string {
  const e = employeeById(c.employee_id);
  const acts = activities().filter((a) => c.evidence_activity_ids.includes(a.id));
  return `- ${c.card_id}｜${e?.name}（${e?.business_unit}／登壇${e?.past_talk_count}回／${e ? busyText(busynessFor(e.id)) : "予定は不明"}）｜${c.reviewed ? "確認済み" : "未確認"}
  要約: ${c.summary}
  テーマ案: ${c.themes.join(" / ")}
  根拠: ${acts.map((a) => `${a.type} ${a.title}`).join("／")}
  打診履歴: ${outreachSummary(c)}`;
}

/**
 * 未発信のカードからブログにしやすいものを選ぶ。
 * opts.cardIds で対象のカードを絞れる（「カード → 出し先を探す」ではこのカード1枚に絞って1件だけ出す）。
 */
export async function suggestBlogIdeas(
  opts: { cardIds?: string[]; count?: number; runId?: string } = {},
): Promise<{ ideas: Array<BlogIdea & { card: Card }>; run_usd: number; total_usd: number }> {
  await loadCalendarIfConfigured();
  const count = opts.count ?? 3;
  const pool = loadCards().filter((c) => c.publication_status === "unpublished" && (!opts.cardIds || opts.cardIds.includes(c.card_id)));
  if (pool.length === 0) return { ideas: [], run_usd: 0, total_usd: totalUsd() };
  const runId = opts.runId ?? randomUUID();
  const { loop: model } = chooseModels();
  const res = await getClient().messages.create({
    model,
    max_tokens: 8000,
    system: `あなたはLayerXの技術広報を手伝います。イベントがなくても発信できるように、ネタ帳の未発信カードからブログにしやすいものを${count}枚選びます（渡されたカードが${count}枚以下なら、そのカードについてブログ案を書きます）。今日は${todayJst()}。時流：${TRENDS.join("／")}
選ぶ基準：
- 数字や具体的な工夫があり、1本の記事として読者が持ち帰れるものがある
- 登壇経験の少ない人を優先する（発信する人としない人の差を埋めたい）
- 確認済みのカードを優先する
- 最近辞退した人、今後2週間の予定が詰まっている人（勤務時間の6割以上が埋まっている）は下げる
why_easy_to_blog は1〜2文、outline は見出しを3〜4個。カードにない事実は足さない。
card_id 以外の項目（title・why_easy_to_blog・outline）は技術広報が読む文です。${PLAIN_TEXT_RULE}。`,
    messages: [{ role: "user", content: `未発信のカード（${pool.length}枚）\n${pool.map(describe).join("\n")}` }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
  });
  recordUsage(runId, "blog_ideas", res.model, res.usage);
  if (res.stop_reason === "refusal") throw new Error("ブログのネタを出せませんでした");
  const text = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(text) as { ideas: BlogIdea[] };
  const byId = new Map(pool.map((c) => [c.card_id, c]));
  const ideas = parsed.ideas
    .filter((i) => byId.has(i.card_id)) // drop anything not in the unpublished pool
    // 使う人向けの文に内部の項目名・idが入ったネタは出さない
    .filter((i) => internalTerms([i.title, i.why_easy_to_blog, ...i.outline].join("\n")).length === 0)
    .slice(0, count)
    .map((i) => ({ ...i, card: byId.get(i.card_id)! }));
  return { ideas, run_usd: runUsd(runId), total_usd: totalUsd() };
}
