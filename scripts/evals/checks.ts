// 評価（docs/evals.md）のコードの判定。名前で登録し、ケースの checks に名前を並べて使う。
// 判定は (ケース, 結果) → pass／fail／unknown。材料（結果のその部分）がなければ unknown（点数に入れない）。
// アプリの関数（入口の検査・返事の検査・内部の言葉の検査）をそのまま呼ぶ。API は使わない。
import type { CheckResult, EvalCase, EvalOutput } from "../../lib/evalTypes";
import { activities, employees } from "../../lib/data";
import { parseInboxInput } from "../../lib/inbox";
import { organizerReplyProblems } from "../../lib/organizerReply";
import { internalTerms } from "../../lib/plainText";
import { MAX_CANDIDATES } from "../../lib/config";

type Check = (c: EvalCase, o: EvalOutput) => Omit<CheckResult, "name">;
const pass = (detail = ""): Omit<CheckResult, "name"> => ({ verdict: "pass", detail });
const fail = (detail = ""): Omit<CheckResult, "name"> => ({ verdict: "fail", detail });
const unknown = (detail = "材料がない"): Omit<CheckResult, "name"> => ({ verdict: "unknown", detail });
const ok = (cond: boolean, detail = "") => (cond ? pass(detail) : fail(detail));

const inputText = (c: EvalCase) => (c.input.kind === "inbox" ? c.input.text : null);
/** 候補の画面に出る文（要約・理由・注意点・見つからない理由） */
export function candidateTexts(o: EvalOutput): string[] {
  const r = o.result;
  if (!r) return [];
  return [r.summary, r.nominee_assessment, ...(r.no_fit?.reasons ?? []), ...(r.no_fit?.next_checks ?? []), ...r.candidates.flatMap((x) => [x.theme, x.reason, x.caveat, ...x.cautions])].filter((t): t is string => !!t);
}
const draftTexts = (o: EvalOutput) => [o.draft?.subject, o.draft?.message, o.draft?.organizer_reply].filter((t): t is string => !!t);

export const CHECKS: Record<string, Check> = {
  // ---- 入口（保存済みの結果がなくても、今のコードで判定できる）
  /** 入口で受け付ける */
  entry_accepted: (c) => {
    const t = inputText(c);
    if (t === null) return unknown("受信箱の入力ではない");
    const p = parseInboxInput({ text: t, source: c.input.kind === "inbox" ? c.input.channel ?? "manual" : "manual" });
    return ok(p.ok, p.ok ? "" : p.error);
  },
  /** 入口で断る（API を呼ぶ前に止まる） */
  entry_rejected: (c) => {
    const t = inputText(c);
    if (t === null) return unknown("受信箱の入力ではない");
    const p = parseInboxInput({ text: t, source: "manual" });
    return ok(!p.ok, p.ok ? "受け付けてしまう" : p.error);
  },

  // ---- 読み取り
  /** 読み取った項目が params.intake と合う（書いた項目だけ比べる。undecided は「含む」） */
  intake_matches: (c, o) => {
    if (!o.intake) return unknown("読み取りの結果がない");
    const want = (c.params?.intake ?? {}) as Record<string, unknown>;
    const got = o.intake as unknown as Record<string, unknown>;
    const bad: string[] = [];
    for (const [k, v] of Object.entries(want)) {
      if (k === "undecided") {
        for (const f of v as string[]) if (!o.intake.undecided.includes(f as never)) bad.push(`${f} が未定になっていない`);
      } else if ((got[k] ?? null) !== v) bad.push(`${k}：${JSON.stringify(got[k] ?? null)}（期待 ${JSON.stringify(v)}）`);
    }
    return ok(bad.length === 0, bad.join("／"));
  },
  /** 読み取りの種類が params.kind（request・not_request・inappropriate） */
  kind_is: (c, o) => {
    if (!o.intake) return unknown("読み取りの結果がない");
    const k = o.intake.kind ?? "request";
    return ok(k === c.params?.kind, `種類 ${k}（期待 ${String(c.params?.kind)}）`);
  },

  // ---- 候補
  candidates_zero: (_c, o) => {
    if (o.rejected) return pass("入口で断った");
    if (o.result === undefined) return unknown("候補の結果がない");
    return ok((o.result?.candidates.length ?? 0) === 0, `候補 ${o.result?.candidates.length ?? 0}人`);
  },
  candidates_some: (_c, o) => (o.result === undefined ? unknown("候補の結果がない") : ok((o.result?.candidates.length ?? 0) > 0, `候補 ${o.result?.candidates.length ?? 0}人`)),
  candidates_max: (_c, o) => (o.result === undefined ? unknown("候補の結果がない") : ok((o.result?.candidates.length ?? 0) <= MAX_CANDIDATES, `候補 ${o.result?.candidates.length ?? 0}人`)),
  /** 候補がいないときは、見つからない理由がある */
  no_fit_has_reason: (_c, o) => {
    if (o.result === undefined) return unknown("候補の結果がない");
    if (!o.result || o.result.candidates.length) return pass();
    return ok((o.result.no_fit?.reasons.length ?? 0) > 0, "見つからない理由がない");
  },
  /**
   * params.expected_ids が候補にいる。
   * 手で作ったケース・試験の一覧は「だれか1人がいれば」（想定候補のいずれか）。
   * 使われた結果から来たケース（source が usage）は「全員がいること」（人がよいと付けた人は、1人ずつ守る）
   */
  expected_in_candidates: (c, o) => {
    if (!o.result) return unknown("候補の結果がない");
    const want = (c.params?.expected_ids ?? []) as string[];
    const got = o.result.candidates.map((x) => x.employee_id);
    const hit = c.source === "usage" ? want.every((id) => got.includes(id)) : want.some((id) => got.includes(id));
    return ok(want.length > 0 && hit, `候補=${got.join(",")} 想定=${want.join(",")}${c.source === "usage" ? "（全員）" : "（いずれか）"}`);
  },
  /** params.unexpected_ids のだれも候補にいない（使われた結果で、人が「違う」と付けた人） */
  not_in_candidates: (c, o) => {
    if (!o.result) return unknown("候補の結果がない");
    const bad = ((c.params?.unexpected_ids ?? []) as string[]).filter((id) => o.result!.candidates.some((x) => x.employee_id === id));
    return ok(bad.length === 0, bad.length ? `候補にいる：${bad.join(",")}` : "");
  },
  /**
   * 読み取った項目が params.intake_expected（項目 → 人が直した値）と合う（使われた結果で、人が読み取りを直したもの）。
   * 日程はそのまま比べる。ほかの項目は、空白と全角半角の違いをならして、どちらかがもう片方を含めば合うとみなす
   */
  intake_fields_match: (c, o) => {
    if (!o.intake) return unknown("読み取りの結果がない");
    const want = (c.params?.intake_expected ?? {}) as Record<string, string>;
    const got = o.intake as unknown as Record<string, unknown>;
    const norm = (s: string) => s.normalize("NFKC").replace(/[\s　]/g, "");
    const bad = Object.entries(want).filter(([k, v]) => {
      const g = typeof got[k] === "string" ? (got[k] as string) : "";
      if (k === "date") return g !== v;
      return !g || !(norm(g).includes(norm(v)) || norm(v).includes(norm(g)));
    });
    return ok(bad.length === 0, bad.map(([k, v]) => `${k}：${JSON.stringify(got[k] ?? null)}（人が直した値 ${JSON.stringify(v)}）`).join("／"));
  },
  /** 自信のある候補が先、条件付きには引っかかる点の文 */
  strong_first_and_caveat: (_c, o) => {
    if (!o.result) return unknown("候補の結果がない");
    let seenConditional = false;
    for (const x of o.result.candidates) {
      if (x.confidence === "conditional") {
        seenConditional = true;
        if (!x.caveat?.trim()) return fail(`${x.name}：条件付きなのに引っかかる点がない`);
      } else if (seenConditional) return fail(`${x.name}：自信のある候補が条件付きの後ろにいる`);
    }
    return pass();
  },
  /** 根拠の id が実在し、候補本人の活動（指名の本人は依頼が根拠なので、なくてよい） */
  evidence_valid: (_c, o) => {
    if (!o.result) return unknown("候補の結果がない");
    const acts = new Map(activities().map((a) => [a.id, a]));
    const bad = o.result.candidates.flatMap((x) => x.evidence.filter((e) => !acts.has(e.id) || acts.get(e.id)!.author_id !== x.employee_id).map((e) => `${x.name}:${e.id}`));
    const none = o.result.candidates.filter((x) => !x.evidence.length && !x.is_nominee && !x.card?.published_ids?.length).map((x) => x.name);
    return ok(!bad.length && !none.length, [...bad, ...none.map((n) => `${n}：根拠なし`)].join("／"));
  },
  /** 使う人向けの文に、内部の項目名・id がない */
  no_internal_terms: (_c, o) => {
    if (!o.result) return unknown("候補の結果がない");
    const hits = candidateTexts(o).flatMap((t) => internalTerms(t));
    return ok(hits.length === 0, [...new Set(hits)].slice(0, 3).join("、"));
  },
  /** params.must_not_appear（[何か, 正規表現の文字列] の並び）が、候補の文・下書き・返事に出ない */
  no_forbidden_words: (c, o) => {
    if (o.rejected) return pass("入口で断った");
    if (o.result === undefined && !o.draft) return unknown("候補も下書きもない");
    const rules = (c.params?.must_not_appear ?? []) as Array<[string, string]>;
    const texts = [...candidateTexts(o), ...draftTexts(o)];
    const hits = rules.flatMap(([what, src]) => texts.filter((t) => new RegExp(src).test(t)).map((t) => `${what}（「${t.match(new RegExp(src))?.[0]}」）`));
    return ok(hits.length === 0, [...new Set(hits)].slice(0, 3).join("、"));
  },
  /** テーマ案に、ほかの社員の名前が入っていない（入っていると、その人で進めたときの主催者への返事が、決まった文に差し替わる） */
  themes_without_other_names: (_c, o) => {
    if (!o.result) return unknown("候補の結果がない");
    const all = employees();
    const hits = o.result.candidates.flatMap((x) =>
      all
        .filter((e) => e.id !== x.employee_id)
        .map((e) => e.name.split(/[\s　]/)[0])
        .filter((fam) => fam.length >= 2 && new RegExp(`${fam}(さん|氏|と|の|が)`).test(x.theme))
        .map((fam) => `${x.name}のテーマ案に「${fam}」`),
    );
    return ok(hits.length === 0, hits.join("／"));
  },

  // ---- 下書き
  /** 候補がいないとき・断ったときは、下書きも返事も作らない */
  no_draft: (_c, o) => {
    if (o.rejected) return pass("入口で断った");
    if (o.result === undefined && o.draft === undefined) return unknown("結果がない");
    return ok(!o.draft?.message && !o.draft?.organizer_reply, "下書きがある");
  },
  /** 主催者への返事が、返事の検査（社内の評価・予定・属性・機密・連絡先・ほかの社員の名前）に通る */
  organizer_reply_clean: (_c, o) => {
    const reply = o.draft?.organizer_reply;
    const first = o.result?.candidates.find((x) => reply?.includes(x.name.split(/[\s　]/)[0])) ?? o.result?.candidates[0];
    if (!reply || !first) return unknown("主催者への返事がない");
    const others = employees().filter((e) => e.id !== first.employee_id).map((e) => e.name);
    const ps = organizerReplyProblems(reply, first.name, others);
    return ok(ps.length === 0, ps[0] ?? "");
  },
};

export const CHECK_NAMES = Object.keys(CHECKS);

/** 1件を、登録された判定で判定する（名前が登録されていなければ fail） */
export function runChecks(c: EvalCase, o: EvalOutput): CheckResult[] {
  return c.checks.map((name) => {
    const fn = CHECKS[name];
    if (!fn) return { name, verdict: "fail" as const, detail: "登録されていない判定" };
    try {
      return { name, ...fn(c, o) };
    } catch (e) {
      return { name, verdict: "fail" as const, detail: `判定の途中で例外：${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
