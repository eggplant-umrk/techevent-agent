import "./_isolate"; // 元のデータだけで動かす（実行時のデータ・金額の記録は一時ファイル）
// ネタ帳の更新で、人が確認したカード（確認済み）を Agent が上書きしないことのテスト
// （API は使わない。決まった応答を返す偽の client で、本物の updateNotebook を流す）。
//   npm run test:reviewed
// 確かめること（docs/spec.md「人が直したカードの扱い」）：
//   - 人が直した項目（要約・テーマ案・おすすめの形と理由）は、Agent が別の中身で出しても変わらない
//   - 事実（根拠の id の追加・最新の活動日）は更新される
//   - 新しいテーマ案は「新しいテーマ案（未確認）」に入り、確定しない
//   - 確認済みの状態は外れない。作業ログに「確認済みカード：内容は変えず」と出る
//   - 確認していないカードは、今までどおり更新される（比べる相手）
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

const EMP = "e012";
const CARD = "card-e012-01";
const RT = process.env.DATA_RUNTIME_DIR!;
const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

type Reply = { stop_reason: Anthropic.Message["stop_reason"]; content: Array<Record<string, unknown>> };
/** 決まった応答を順に返す偽の client（scripts/test_notebook_loop.ts と同じ形） */
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
const upsert = (id: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name: "upsert_card", input });

async function main() {
  delete process.env.DATA_SOURCE;
  delete process.env.DEMO_PERSON;
  const { updateNotebook } = await import("../lib/notebook");
  const { activities } = await import("../lib/data");
  const { editCard, getCardById } = await import("../lib/cards");

  const before = getCardById(CARD);
  if (!before) throw new Error(`${CARD} が元のデータにありません`);
  const own = activities().filter((a) => a.author_id === EMP && a.type !== "blog" && a.type !== "slack");
  const extra = own.find((a) => !before.evidence_activity_ids.includes(a.id));
  if (!extra) throw new Error(`${EMP} に、カードの根拠に入っていない活動がありません`);

  /** 読んだ記録を空にして、活動をすべて「新しい活動」にする。カード（実行時のデータ）も元に戻す */
  const reset = () => {
    fs.rmSync(path.join(RT, "cards.json"), { force: true });
    fs.rmSync(path.join(RT, "notebook_state.json"), { force: true });
    fs.writeFileSync(path.join(RT, "notebook_progress.json"), JSON.stringify({ [EMP]: { processed: [], updated_at: "2026-11-01T00:00:00+09:00", last: null } }));
  };

  // Agent が出す更新：確認済みのカードに、別の要約・別のテーマ案・別の形を書こうとし、根拠を1件足す
  const agentInput = {
    card_id: CARD,
    summary: "Agent が書き直した要約です。人が直した文とは別の中身になっています。",
    themes: ["Agent が考えた新しいテーマ案：依存の棚卸しを続ける仕組み"],
    evidence_activity_ids: [...before.evidence_activity_ids, extra.id],
    format: "talk",
    format_reason: "Agent が書き直した理由",
    published_ids: [],
    announcement_activity_ids: [],
  };
  const run = async () => {
    const events: Array<{ type: string; action?: string; message?: string }> = [];
    const client = fakeClient([{ stop_reason: "tool_use", content: [upsert("t1", agentInput)] }]);
    await updateNotebook([EMP], (e) => events.push(e as never), { client });
    return { events, calls: client.calls() };
  };

  // ---- 1. 人が確認したカード ----
  reset();
  const HUMAN_SUMMARY = "技術広報が直した要約：初期表示を速くするために、使っていない依存を外した取り組み。";
  const HUMAN_THEME = "技術広報が決めたテーマ：使っていない依存を外して初期表示を速くした話";
  const edited = editCard(CARD, { summary: HUMAN_SUMMARY, themes: [HUMAN_THEME], format: "lt", format_reason: "技術広報が直した理由：1つの工夫に絞れる" });
  check("準備：画面で直すと確認済みになる", edited.ok && edited.card?.reviewed === true && edited.card.edited_fields.includes("summary"), edited.errors.join(" / "));
  const human = getCardById(CARD)!;

  let r = await run();
  const after = getCardById(CARD)!;
  check("偽の API を1回呼んで、カードの更新が流れた", r.calls === 1 && r.events.some((e) => e.type === "card"), `呼び出し ${r.calls}回`);
  check("要約は人が直したまま", after.summary === HUMAN_SUMMARY, after.summary);
  check("テーマ案は人が直したまま", JSON.stringify(after.themes) === JSON.stringify([HUMAN_THEME]), after.themes.join("／"));
  check("おすすめの形と理由は人が直したまま", after.format === "lt" && after.format_reason === human.format_reason, `${after.format}／${after.format_reason}`);
  check("確認済みの状態と、直した項目の記録は外れない", after.reviewed === true && after.reviewed_at === human.reviewed_at && JSON.stringify(after.edited_fields) === JSON.stringify(human.edited_fields));
  check("根拠の id は足される（事実は更新してよい）", after.evidence_activity_ids.includes(extra.id) && before.evidence_activity_ids.every((id) => after.evidence_activity_ids.includes(id)), after.evidence_activity_ids.join(","));
  check("Agent のテーマ案は「新しいテーマ案（未確認）」に入り、確定しない", after.pending_themes.includes(agentInput.themes[0]) && !after.themes.includes(agentInput.themes[0]), after.pending_themes.join("／"));
  check("Agent が書いた要約・理由はどこにも残らない", !JSON.stringify(after).includes("Agent が書き直した"));
  const cardEvent = r.events.find((e) => e.type === "card");
  check("作業ログに「確認済みカード：内容は変えず」と出る", cardEvent?.action === "kept_reviewed" && !!cardEvent.message?.includes("確認済みカード：内容は変えず"), cardEvent?.message ?? "");

  // もう一度流しても同じ（同じテーマ案が二重に入らない）
  fs.writeFileSync(path.join(RT, "notebook_progress.json"), JSON.stringify({ [EMP]: { processed: [], updated_at: "2026-11-01T00:00:00+09:00", last: null } }));
  r = await run();
  const again = getCardById(CARD)!;
  check("もう一度流しても、人が直した文はそのままで、未確認のテーマ案は増えない", again.summary === HUMAN_SUMMARY && again.pending_themes.filter((t) => t === agentInput.themes[0]).length === 1, again.pending_themes.join("／"));

  // ---- 2. 確認していないカード（比べる相手）：今までどおり Agent の内容で更新される ----
  reset();
  const fresh = getCardById(CARD)!;
  check("準備：元のカードは確認済みではない", fresh.reviewed === false && fresh.summary === before.summary);
  r = await run();
  const updated = getCardById(CARD)!;
  check("確認していないカードは、Agent の内容で更新される", updated.summary === agentInput.summary && updated.format === "talk" && updated.reviewed === false, updated.summary);
  check("そのときの作業ログは「更新したカード」", r.events.some((e) => e.type === "card" && e.action === "updated"));

  // ---- 3. 元のデータには書いていない ----
  const baseFile = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "cards.json"), "utf-8")) as Array<{ card_id: string; summary: string; reviewed: boolean }>;
  const base = baseFile.find((c) => c.card_id === CARD)!;
  check("元のデータ（data/cards.json）は変わっていない", base.summary === before.summary && base.reviewed === before.reviewed);
  check("金額の記録は一時ファイル（本物の data/usage.json は使わない）", process.env.USAGE_FILE!.startsWith(RT));

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
