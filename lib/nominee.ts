// 受信箱から届く依頼の「指名された人」。
// 依頼文から名前を読み取るのは Agent（小さな1回の呼び出し）、社員データに実在するかの判定はコード。
// 実在しない・1人に決まらないときは指名なしとして扱い、そのことを注意点に書く。
import { getClient } from "./anthropic";
import { employees } from "./data";
import { chooseModels, recordUsage } from "./usage";

export interface NomineeReading {
  /** 依頼文に書かれていた名前（書かれたとおり）。指名がなければ null */
  name: string | null;
  /** 社員データで1人に決まったときの社員 */
  employee_id: string | null;
  /** 指名なしとして扱った理由（使う人向けの文）。決まったとき・指名がないときは null */
  note: string | null;
}

/** 依頼文から指名された名前を読み取る関数（テストでは偽物に差し替える） */
export type NomineeExtractor = (text: string, runId: string) => Promise<string | null>;

const HONORIFICS = /(さん|様|さま|氏|くん|君|ちゃん|先生)$/;
const norm = (s: string) => s.replace(/[\s　]/g, "").replace(HONORIFICS, "");

/** 読み取った名前を社員データと照らす（コードで判定） */
export function resolveNominee(name: string | null): NomineeReading {
  if (!name || !name.trim()) return { name: null, employee_id: null, note: null };
  const n = norm(name.trim());
  const all = employees();
  const full = all.filter((e) => norm(e.name) === n);
  if (full.length === 1) return { name, employee_id: full[0].id, note: null };
  const family = all.filter((e) => norm(e.name.split(/[\s　]/)[0]) === n);
  if (family.length === 1) return { name, employee_id: family[0].id, note: null };
  if (family.length > 1) {
    return {
      name,
      employee_id: null,
      note: `依頼文で指名されている「${name}」は同じ姓の社員が複数いて1人に決まらないため、指名なしとして扱いました。依頼元にフルネームを確認してください`,
    };
  }
  return {
    name,
    employee_id: null,
    note: `依頼文で指名されている「${name}」は社員データに見つからないため、指名なしとして扱いました。名前の表記を依頼元に確認してください`,
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    nominated_name: { type: ["string", "null"] },
  },
  required: ["nominated_name"],
  additionalProperties: false,
};

/** 本物の読み取り（Agent への小さな1回の呼び出し） */
export const extractNomineeWithAgent: NomineeExtractor = async (text, runId) => {
  const { loop: model } = chooseModels();
  const res = await getClient().messages.create({
    model,
    max_tokens: 2000,
    system: `社外から届いた登壇依頼の文を読み、依頼元が登壇者として名前を挙げて指名している「LayerX社内の人」の名前を1人だけ、文に書かれているとおりに抜き出してください。
- 依頼元の担当者や主催者の名前は含めない
- 「どなたか」「LayerXさんの枠」のように名前がなければ null
- 推測で補わない。敬称（さん・様）はあってもなくてもよい`,
    messages: [{ role: "user", content: text }],
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
  });
  recordUsage(runId, "inbox_extract", res.model, res.usage);
  if (res.stop_reason === "refusal") return null;
  const out = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(out) as { nominated_name: string | null };
  return parsed.nominated_name?.trim() || null;
};
