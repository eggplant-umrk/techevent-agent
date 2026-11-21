import "./_isolate"; // 元のデータだけで動かす（実行時のデータ・金額の記録は一時ファイル）
// ネタ帳の更新のループのテスト（API は使わない。決まった応答を返す偽の client で流す）。
//   npm run test:loop
// 確かめること：出力が途中で切れたとき・差し戻したのに直らないまま終わったときは、新しい活動を「読んだ」にしない。
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

const EMP = "e012";
const RT = process.env.DATA_RUNTIME_DIR!;
const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

type Reply = { stop_reason: Anthropic.Message["stop_reason"]; content: Array<Record<string, unknown>> };
/** 決まった応答を順に返す偽の client */
function fakeClient(replies: Reply[]) {
  let i = 0;
  return {
    calls: () => i,
    messages: {
      create: async () => {
        const r = replies[Math.min(i++, replies.length - 1)];
        return { id: `msg_${i}`, type: "message", role: "assistant", model: "claude-opus-5-5", usage, stop_sequence: null, ...r };
      },
    },
  } as unknown as Pick<Anthropic, "messages"> & { calls: () => number };
}

const text = (t: string) => ({ type: "text", text: t });
const upsert = (id: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name: "upsert_card", input });

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  const { updateNotebook } = await import("../lib/notebook");
  const { activities } = await import("../lib/data");
  const { loadCards } = await import("../lib/cards");
  const own = activities().filter((a) => a.author_id === EMP && a.type !== "blog" && a.type !== "slack");
  const evid = own[0].id;
  const good = {
    card_id: null,
    summary: "ログの出し方を整理し、障害のときに原因へたどり着くまでの時間を短くした。",
    themes: ["障害調査が速くなるログの出し方の決め方"],
    evidence_activity_ids: [evid],
    format: "lt",
    format_reason: "1つの工夫に絞って話せるため",
    published_ids: [],
    announcement_activity_ids: [],
  };
  const bad = { ...good, evidence_activity_ids: ["act999"] }; // 存在しない根拠 → 差し戻し

  /** e012 の読んだ記録を空にして、活動をすべて「新しい活動」にする */
  const reset = () => {
    fs.rmSync(path.join(RT, "cards.json"), { force: true });
    fs.rmSync(path.join(RT, "notebook_state.json"), { force: true });
    fs.writeFileSync(path.join(RT, "notebook_progress.json"), JSON.stringify({ [EMP]: { processed: [], updated_at: "2026-11-01T00:00:00+09:00", last: null } }));
  };
  const progress = () => (JSON.parse(fs.readFileSync(path.join(RT, "notebook_progress.json"), "utf-8")) as Record<string, { processed: string[] }>)[EMP];
  const run = async (replies: Reply[]) => {
    reset();
    const events: Array<{ type: string; message?: string }> = [];
    const client = fakeClient(replies);
    await updateNotebook([EMP], (e) => events.push(e as never), { client });
    return { events, read: progress().processed.length, calls: client.calls() };
  };

  // 1. 出力が途中で切れた（ツールの呼び出しなし）→ 読んだことにしない
  let r = await run([{ stop_reason: "max_tokens", content: [text("カードを作ります。まず")] }]);
  check("出力が途中で切れたら、読んだことにしない", r.read === 0 && r.events.some((e) => e.type === "error" && e.message!.includes("途中で切れました")), `読んだ ${r.read}件`);
  check("「カードなし」とは扱わない", !r.events.some((e) => e.type === "no_card"));

  // 2. 出力が途中で切れた（ツールの呼び出しあり）→ 読んだことにしない
  r = await run([{ stop_reason: "max_tokens", content: [upsert("t1", good)] }]);
  check("ツールの呼び出しの途中で切れても、読んだことにしない", r.read === 0, `読んだ ${r.read}件`);

  // 3. 差し戻したのに、直した提出がないまま終わった → 読んだことにしない
  r = await run([
    { stop_reason: "tool_use", content: [upsert("t1", bad)] },
    { stop_reason: "end_turn", content: [text("カードにするものはありません")] },
  ]);
  check("差し戻しのあと直さずに終わったら、読んだことにしない", r.read === 0 && r.calls === 2 && r.events.some((e) => e.type === "rejected"), `読んだ ${r.read}件・呼び出し ${r.calls}回`);
  check("そのときは「カードなし」ではなくエラーとして知らせる", r.events.some((e) => e.type === "error" && e.message!.includes("直されないまま")) && !r.events.some((e) => e.type === "no_card"));

  // 4. 差し戻しても、上限の回数まで直らなかった → 読んだことにしない
  r = await run([{ stop_reason: "tool_use", content: [upsert("t1", bad)] }]);
  check("上限の回数まで直らなければ、読んだことにしない", r.read === 0 && r.calls === 3, `読んだ ${r.read}件・呼び出し ${r.calls}回`);

  // 5. 差し戻したあと、直した提出が通った → 読んだことにする
  r = await run([
    { stop_reason: "tool_use", content: [upsert("t1", bad)] },
    { stop_reason: "tool_use", content: [upsert("t2", good)] },
  ]);
  check("差し戻しのあと直した提出が通れば、読んだことにする", r.read === own.length && loadCards().some((c) => c.employee_id === EMP && c.evidence_activity_ids.includes(evid) && c.themes[0] === good.themes[0]), `読んだ ${r.read}件`);

  // 6. 1回で通った → 読んだことにする
  r = await run([{ stop_reason: "tool_use", content: [upsert("t1", good)] }]);
  check("1回で通れば、読んだことにする", r.read === own.length && r.calls === 1);

  // 7. 差し戻しなしで「カードなし」→ 読んだことにする（カードにするものがなかった）
  r = await run([{ stop_reason: "end_turn", content: [text("カードにするものはありません：ログの整理だけでした")] }]);
  check("差し戻しなしの「カードなし」は、読んだことにする", r.read === own.length && r.events.some((e) => e.type === "no_card"));

  check("金額の記録は一時ファイル（本物の data/usage.json は使わない）", process.env.USAGE_FILE!.startsWith(RT));

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
