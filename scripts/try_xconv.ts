// X の会話の貼り付け → 候補 → 主催者への返事、を本物の API で1回だけ通す確認用（API代がかかる）。
//   npx tsx scripts/try_xconv.ts [x1|x2|x3]   （既定 x2）
// - .env は TRY_ENV_FILE（既定 .env）からこのプロセスにだけ読む。キーの値は表示しない
// - 受信箱は一時ファイルに書く（data/inbox.json には触らない）。打診の結果は書き戻さない（下書きまで）
// - 累計が上限（TRY_LIMIT_USD、既定 0.5）を超えそうなら、下書きの前で止める
// - 結果は ?mock で見せるために app/_client/xconv.json に保存する
import fs from "node:fs";
import path from "node:path";
import { X_CONVERSATIONS } from "./fixtures/x_conversations";

const LIMIT = Number(process.env.TRY_LIMIT_USD || "0.5");

async function main() {
  const envFile = process.env.TRY_ENV_FILE || ".env";
  if (!fs.existsSync(envFile)) {
    console.error(`${envFile} がありません（TRY_ENV_FILE で .env の場所を指定してください）`);
    process.exit(1);
  }
  process.loadEnvFile(envFile);
  delete process.env.DATA_SOURCE; // 架空データで確かめる

  const id = process.argv[2] || "x2";
  const conv = X_CONVERSATIONS.find((c) => c.id === id);
  if (!conv) throw new Error(`会話 ${id} がありません`);

  const tmp = path.join(process.cwd(), "eval-results", `try-xconv-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  process.env.INBOX_FILE = tmp;

  const { registerInbox, prepare, getInboxItem, detailView } = await import("../lib/inbox");
  const { extractIntakeWithAgent } = await import("../lib/intake");
  const { runAgent } = await import("../lib/agent");
  const { draftOutreach } = await import("../lib/heavy");
  const { resolveRequest } = await import("../lib/requests");
  const { organizerReplyProblems } = await import("../lib/organizerReply");
  const { employees } = await import("../lib/data");

  try {
    console.log(`=== ${conv.id} ${conv.title}`);
    const reg = registerInbox({ text: conv.text, source: "manual" });
    await prepare(reg.id, (request, emit) => runAgent(request, emit), extractIntakeWithAgent);
    const it = getInboxItem(reg.id)!;
    // 候補づくりは自分の run_id で記録されるので、受信箱に残る合計（読み取り＋候補づくり）を使う
    const used1 = it.run_usd;
    console.log("\n# 読み取った項目（コードで確かめたあと）");
    console.log(JSON.stringify({ intake: it.intake, nominee: it.nominee }, null, 2));
    console.log(`\n# 候補（${it.status}）`);
    for (const c of it.result?.candidates ?? []) console.log(`- ${c.name}（${c.confidence}）${c.theme}\n  注意：${c.cautions.join("／")}`);
    if (it.result?.no_fit) console.log(`見つからない理由：${it.result.no_fit.reasons.join("／")}`);
    console.log(`\n読み取り＋候補づくり：$${used1.toFixed(3)}`);

    const first = it.result?.candidates[0];
    let draft = null;
    let draftUsd = 0;
    if (!first) {
      console.log("候補がいないので、主催者への返事は作りません");
    } else if (used1 + 0.2 > LIMIT) {
      console.log(`上限 $${LIMIT} を超えそうなので、下書きの前で止めます`);
    } else {
      const request = resolveRequest({ request_id: reg.id })!;
      const r = await draftOutreach(reg.id, request, {
        employee_id: first.employee_id,
        theme: first.theme,
        reason: first.reason,
        evidence_activity_ids: first.evidence.map((e) => e.id),
      });
      draft = r.value;
      draftUsd = r.cost_usd;
      const others = employees()
        .filter((e) => e.id !== first.employee_id)
        .map((e) => e.name);
      console.log(`\n# 主催者への返事（${first.name}さんで進める場合、${r.model}${r.fellBack ? "・作り直し" : ""}）`);
      console.log(draft.organizer_reply);
      if (draft.organizer_reply_note) console.log(`（${draft.organizer_reply_note}）`);
      const ps = organizerReplyProblems(draft.organizer_reply ?? "", first.name, others);
      console.log(`検査：${ps.length ? ps.join(" / ") : "問題なし"}（${(draft.organizer_reply ?? "").length}字）`);
      console.log(`\n# 声かけ文の件名：${draft.subject}`);
    }
    const total = used1 + draftUsd;
    console.log(`\n今回の合計：$${total.toFixed(3)}`);

    // ?mock 用に保存（id はモックの受信箱に合わせて付け替える）
    const detail = { ...detailView(it), id: `inb-mock-${conv.id}`, received_at: "2026-11-21T10:30:00+09:00", is_new: true };
    const out = path.join(process.cwd(), "app", "_client", "xconv.json");
    const json = JSON.stringify({ conversation: conv.id, run_usd: total, detail, draft }, null, 2).replaceAll(reg.id, detail.id);
    fs.writeFileSync(out, json + "\n");
    console.log(`保存：${path.relative(process.cwd(), out)}`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
