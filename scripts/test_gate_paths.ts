// 関所を通らない道を閉じたことのテスト（API を使わない）：npx tsx scripts/test_gate_paths.ts
//   - 読み取りの AI が拒否したら「不適切」、読み取りに失敗したら「エラー」として止める（依頼として候補づくりを走らせない）
//   - 失敗した1件を「もう一度探す」で読み直すときも関所を通す（rereadIfFailed）
//   - 貼った文（custom_text）を直接 /api/agent・/api/draft に送っても依頼にしない
//   - アンケート分析の指示文は控えを持たず、カードを直したら次の分析から新しい文になる
import "./_isolate"; // 元のデータだけで動かす（実行時のデータ data/runtime/ は読まない・書かない）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, ProposalResult } from "../lib/agent";
import type { SpeakingRequest } from "../lib/data";

const tmp = path.join(os.tmpdir(), `gate-paths-${Date.now()}.json`);
process.env.INBOX_FILE = tmp;

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

async function main() {
  const inbox = await import("../lib/inbox");
  const { resolveRequest, CUSTOM_TEXT_CLOSED } = await import("../lib/requests");
  const { loadCards, editCard } = await import("../lib/cards");
  const { surveySystem } = await import("../lib/surveys");

  let runs = 0;
  const runner = async (request: SpeakingRequest, emit: (e: AgentEvent) => void): Promise<ProposalResult | null> => {
    runs++;
    emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
    return { run_id: "gate", request_id: request.id, request_pattern: "open_slot", summary: "", nominee_assessment: null, learnings_applied: [], no_fit: { reasons: ["該当なし"], next_checks: [] }, candidates: [] };
  };
  const empty = { value: null, quote: null };
  const raw = (kind: "request" | "not_request" | "inappropriate") => ({
    event_name: { value: "テスト勉強会", quote: "テスト勉強会" },
    date: empty,
    format: empty,
    theme: empty,
    organizer: empty,
    nominee: empty,
    date_hint: empty,
    kind: { value: kind, reason: kind === "request" ? "登壇の依頼" : "雑談" },
  });
  const text = "「テスト勉強会」でLTをお願いできる方を探しています";

  // ---------------------------------------------------------------- 拒否 → 不適切
  {
    runs = 0;
    const it = inbox.registerInbox({ text: text + "（拒否）", source: "manual" });
    await inbox.prepare(it.id, runner, async () => null);
    const x = inbox.getInboxItem(it.id)!;
    check("読み取りの AI が拒否したら「不適切」として止める", x.status === "ready" && x.kind === "inappropriate" && x.read_status === "refused" && x.kind_reason === inbox.READ_REFUSED_REASON, JSON.stringify({ s: x.status, k: x.kind, r: x.read_status }));
    check("拒否したものは候補づくりを走らせない", runs === 0 && x.result === null);
    check("拒否したものは候補づくり・下書き・返事に使えない", resolveRequest({ request_id: it.id }) === null);
    check("拒否したものは「依頼として進める」もできない", !inbox.proceedAsRequest(it.id, runner).ok);
  }

  // ---------------------------------------------------------------- 失敗 → エラー
  const failedItem = inbox.registerInbox({ text: text + "（失敗）", source: "manual" });
  {
    runs = 0;
    await inbox.prepare(failedItem.id, runner, async () => {
      throw new Error("読み取りの API が 500");
    });
    const x = inbox.getInboxItem(failedItem.id)!;
    check("読み取りに失敗したら「エラー」として止める", x.status === "error" && x.read_status === "failed" && !!x.error?.startsWith(inbox.READ_FAILED_ERROR), JSON.stringify({ s: x.status, r: x.read_status, e: x.error }));
    check("失敗したものは候補づくりを走らせない", runs === 0 && x.result === null);
    check("失敗したものは候補づくり・下書き・返事に使えない（「もう一度探す」で読み直すまで）", resolveRequest({ request_id: failedItem.id }) === null);
    // 読み取りの手段がないとき（extractor なし）に準備し直しても、依頼として走らせない
    await inbox.prepare(failedItem.id, runner);
    check("読み取りに失敗したままのものは、読み取りなしで準備し直しても走らせない", runs === 0 && inbox.getInboxItem(failedItem.id)!.status === "error");
    // 準備し直すと、読み取りからやり直す（指名・項目は保存していない）
    await inbox.prepare(failedItem.id, runner, async () => raw("request"));
    const y = inbox.getInboxItem(failedItem.id)!;
    check("読み取りに失敗したものを準備し直すと、読み直してから候補づくりへ", runs === 1 && y.status === "ready" && y.read_status === null && y.kind === "request", JSON.stringify({ runs, s: y.status, r: y.read_status }));
  }

  // ---------------------------------------------------------------- 「もう一度探す」（/api/agent）の前の読み直し
  {
    const mk = async () => {
      const it = inbox.registerInbox({ text: `${text}（読み直し ${Math.random()}）`, source: "manual" });
      await inbox.prepare(it.id, runner, async () => {
        throw new Error("x");
      });
      return it.id;
    };
    const a = await mk();
    await inbox.rereadIfFailed(a, async () => {
      throw new Error("また失敗");
    });
    check("読み直しもまた失敗したら、失敗のまま（依頼として引けない）", inbox.getInboxItem(a)!.read_status === "failed" && resolveRequest({ request_id: a }) === null);
    await inbox.rereadIfFailed(a, async () => raw("request"));
    check("読み直して依頼と読めたら、依頼として引ける", inbox.getInboxItem(a)!.read_status === null && resolveRequest({ request_id: a })?.id === a);
    const b = await mk();
    await inbox.rereadIfFailed(b, async () => raw("not_request"));
    const xb = inbox.getInboxItem(b)!;
    check("読み直して「依頼ではない」と読めたら止める", xb.kind === "not_request" && xb.status === "ready" && resolveRequest({ request_id: b }) === null);
    const c = await mk();
    await inbox.rereadIfFailed(c, async () => null);
    const xc = inbox.getInboxItem(c)!;
    check("読み直しで拒否されたら「不適切」として止める", xc.kind === "inappropriate" && xc.read_status === "refused" && resolveRequest({ request_id: c }) === null);
    const d = await mk();
    await inbox.rereadIfFailed(d, async () => raw("inappropriate"));
    check("読み直して「不適切」と読めたら止める", inbox.getInboxItem(d)!.kind === "inappropriate" && resolveRequest({ request_id: d }) === null);
  }

  // ---------------------------------------------------------------- custom_text の道を閉じた
  {
    check("貼った文（custom_text）だけでは依頼にしない", resolveRequest({ custom_text: "どなたか登壇してください" }) === null);
    check("custom- の id と貼った文でも依頼にしない", resolveRequest({ request_id: "custom-abc", custom_text: "どなたか登壇してください" }) === null);
    check("サンプルの依頼の id に貼った文を添えても、貼った文の道は通さない", resolveRequest({ request_id: "req001", custom_text: "別の文" }) === null);
    check("サンプルの依頼は id で引ける（今までどおり）", resolveRequest({ request_id: "req001" })?.id === "req001");
    check("断りの文は受信箱に入れるよう案内する", CUSTOM_TEXT_CLOSED.includes("受信箱"));
    const agentRoute = fs.readFileSync(path.join(process.cwd(), "app", "api", "agent", "route.ts"), "utf-8");
    const draftRoute = fs.readFileSync(path.join(process.cwd(), "app", "api", "draft", "route.ts"), "utf-8");
    check("/api/agent と /api/draft は custom_text を 400 で断る", [agentRoute, draftRoute].every((s) => /if \(body\.custom_text\) return Response\.json\(\{ error: CUSTOM_TEXT_CLOSED \}, \{ status: 400 \}\)/.test(s)));
    check("/api/agent は失敗した1件を読み直してから引く", agentRoute.indexOf("rereadIfFailed(") > 0 && agentRoute.indexOf("rereadIfFailed(") < agentRoute.indexOf("resolveRequest(body)"));
  }

  // ---------------------------------------------------------------- アンケート分析の指示文（控えを持たない）
  {
    const card = loadCards().find((c) => c.publication_status === "unpublished")!;
    const before = surveySystem();
    const r = editCard(card.card_id, { summary: "直したあとの未発信のまとめ（テスト）" });
    const after = surveySystem();
    check("（準備）カードを直せた", r.ok);
    check("カードを直したら、次の分析の指示文は新しい文になる（古い控えを使わない）", !before.includes("直したあとの未発信のまとめ") && after.includes("直したあとの未発信のまとめ（テスト）"));
    const src = fs.readFileSync(path.join(process.cwd(), "lib", "surveys.ts"), "utf-8");
    check("アンケート分析の指示文の控え（SYSTEM_CACHE）はない", !/SYSTEM_CACHE|cachedSystem/.test(src));
  }

  fs.rmSync(tmp, { force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exitCode = failed ? 1 : 0;
}

main();
