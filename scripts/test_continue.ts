// 続きの会話で、同じ受信箱の依頼を更新する仕組みのテスト（API を使わない）。
//   npx tsx scripts/test_continue.ts
// 見分け（含む／含まない／アカウントとイベント名だけ同じ）と、更新（日程だけ変わる／指名が変わる／何も変わらない／関所／読み取りの失敗）。
import "./_isolate";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent, ProposalResult } from "../lib/agent";
import type { RawIntake } from "../lib/intake";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "continue-test-"));
process.env.INBOX_FILE = path.join(tmp, "inbox.json");
process.env.USAGE_FILE = path.join(tmp, "usage.json");
process.env.DATA_RUNTIME_DIR = path.join(tmp, "runtime");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

const q = (value: string | null, quote: string | null = value) => ({ value, quote });
const none = q(null, null);

const A = "@infra_study_tokyo\nLayerXさん、Infra Study Tokyo の西村です！SREやオンコールの改善まわりで、LT15分をお願いできる方を探しています。\n\n@infra_study_tokyo\n日程は12月中で調整中です。オンラインです。";
const B = `${A}\n\n@LayerX_tech\nありがとうございます！確認しますね。\n\n@infra_study_tokyo\n日程が決まりました。12月17日（木）19時からです。`;
const C = `${B}\n\n@LayerX_tech\n承知しました！`;
const D = `${C}\n\n@infra_study_tokyo\nできれば芹沢 葵さんにお願いしたいです。`;
const E = `${D}\n\n@infra_study_tokyo\nところで来週ご飯でもどうですか。`;

async function main() {
  const C0 = await import("../lib/continuation");
  const inbox = await import("../lib/inbox");
  const board = await import("../lib/board");

  // ---- 1. 見分け（コード）
  console.log("━ 続きの見分け");
  const targets = [{ id: "x1", text: A, event_name: "Infra Study Tokyo" }];
  check("含む：前の会話をまるごと含んでいれば、その依頼の続き", C0.findContinuation(B, targets)?.kind === "contains");
  const loose = B.replace(/\n/g, "\r\n  ").replace(/、/g, "、 ");
  check("含む：空白・改行が違っても、続きとみなす", C0.findContinuation(loose, targets)?.kind === "contains");
  check("同じ文は、続きではない（同じ依頼として別に扱う）", C0.findContinuation(A.replace(/\n/g, "\n "), targets) === null);
  check("含まない：別の人・別のイベントなら、新しい依頼", C0.findContinuation("@other_meetup\n「Other Night」の森です。LTをお願いできる方を探しています。", targets) === null);
  const ask = C0.findContinuation("@infra_study_tokyo\nInfra Study Tokyo の西村です。先日の件、日程が12月17日（木）に決まりました！", targets);
  check("アカウントとイベント名だけ同じ：聞き返す（勝手に更新しない）", ask?.kind === "ask" && ask.id === "x1" && ask.title === "Infra Study Tokyo", JSON.stringify(ask));
  check("アカウントが同じでも、イベント名が違えば新しい依頼", C0.findContinuation("@infra_study_tokyo\n別の「Cloud Night」の件でご相談です。LTをお願いできますか。", targets) === null);
  check("イベント名が同じでも、アカウントが違えば新しい依頼", C0.findContinuation("@someone_else\nInfra Study Tokyo に参加した者です。LTをお願いできますか。", targets) === null);
  const two = [{ id: "short", text: A, event_name: null }, { id: "long", text: B, event_name: null }];
  check("含む会話が2つあれば、長いほう（新しいほう）の依頼を選ぶ", (C0.findContinuation(C, two) as { id: string } | null)?.id === "long");

  // ---- 2. 変わった項目（コードで前と比べる）
  console.log("\n━ 変わった項目");
  const base = { event_name: "Infra Study Tokyo", date: null, date_hint: null, format: "LT15分", theme: "SRE", extra: { venue: "オンライン" } };
  const ch1 = C0.intakeChanges({ nominee_name: null, intake: base }, { nominee_name: null, intake: { ...base, date: "2026-12-17" } });
  check("日程だけ変わる：「日程：未定 → 12月17日（木）」", ch1.length === 1 && C0.changeLine(ch1[0]) === "日程：未定 → 12月17日（木）" && C0.needsRerun(ch1), ch1.map(C0.changeLine).join(" / "));
  const ch2 = C0.intakeChanges({ nominee_name: "芹沢", intake: base }, { nominee_name: "鳴海", intake: base });
  check("指名が変わる：「指名：芹沢さん → 鳴海さん」", ch2.length === 1 && C0.changeLine(ch2[0]) === "指名：芹沢さん → 鳴海さん" && C0.needsRerun(ch2));
  check("何も変わらない：一覧は空で、候補づくりはやり直さない", C0.intakeChanges({ nominee_name: null, intake: base }, { nominee_name: null, intake: { ...base } }).length === 0);
  const ch3 = C0.intakeChanges({ nominee_name: null, intake: base }, { nominee_name: null, intake: { ...base, extra: { venue: "渋谷" } } });
  check("会場だけ変わる：一覧には出すが、候補づくりはやり直さない", ch3.length === 1 && ch3[0].label === "会場" && !C0.needsRerun(ch3));

  // ---- 3. 同じ依頼の更新
  console.log("\n━ 同じ依頼の更新");
  const saved = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "eval_after.json"), "utf-8")) as { rows: Array<{ request_id: string; result: ProposalResult }> };
  const sample = saved.rows.find((r) => r.request_id === "req001")!.result;
  let runs = 0;
  const runner = async (request: { id: string }, emit: (e: AgentEvent) => void) => {
    runs++;
    emit({ type: "done", run_usd: 0, total_usd: 0, steps: 1 });
    return { ...sample, request_id: request.id, alternative_pitch: undefined, candidates: sample.candidates.map((c) => ({ ...c, is_alternative_to_nominee: false })) };
  };
  let failNext = false;
  const extractor = async (text: string): Promise<RawIntake | null> => {
    if (failNext) throw new Error("timeout");
    const decided = text.includes("12月17日（木）19時から");
    const chat = text.includes("ご飯でも");
    return {
      event_name: q("Infra Study Tokyo"),
      date: decided ? q("2026-12-17", "12月17日（木）19時から") : none,
      format: q("LT15分"),
      theme: q("SREやオンコールの改善"),
      organizer: q("西村"),
      nominee: text.includes("芹沢 葵さん") ? q("芹沢 葵") : none,
      date_hint: none,
      kind: chat ? { value: "not_request", reason: "食事の誘い" } : { value: "request", reason: null },
    } as RawIntake;
  };
  const pitcher = async () => ({ value: "推す文", model: "fake", fellBack: false });

  const item = inbox.registerInbox({ text: A, source: "manual" });
  await inbox.prepare(item.id, runner, extractor, pitcher);
  const first = inbox.getInboxItem(item.id)!;
  check("準備：最初の会話は日程が未定で、候補ができる", first.status === "ready" && first.intake?.date === null && runs === 1, `${first.status} ${first.intake?.date} ${runs}`);
  check("受信箱の見分け：続きを貼ると、その依頼が見つかる", (board.findActiveContinuation(B) as { id: string } | null)?.id === item.id);

  // 日程だけ変わる
  await inbox.continuePrepared(item.id, first, B, runner, extractor, pitcher);
  const second = inbox.getInboxItem(item.id)!;
  check("日程だけ変わる：件数は増えず、会話が新しいものに差し替わる", inbox.listInbox().length === 1 && second.text === B);
  check("日程だけ変わる：読み取りをやり直し、日程が入る", second.intake?.date === "2026-12-17");
  check("日程だけ変わる：変わった項目に日程が出る", second.last_update?.changes.map(C0.changeLine).join("/") === "日程：未定 → 12月17日（木）", second.last_update?.changes.map(C0.changeLine).join("/"));
  check("日程だけ変わる：候補づくりをやり直す", runs === 2 && second.last_update?.rerun === true && second.status === "ready");
  check("日程だけ変わる：前の候補を消さずに残す", second.previous?.length === 1 && second.previous[0].text === A && (second.previous[0].result?.candidates.length ?? 0) > 0);
  const view = inbox.detailView(second);
  check("画面用：前の候補（時刻・名前・テーマ）と、変わった項目を返す", view.previous?.length === 1 && !!view.previous[0].candidates[0]?.name && view.last_update?.changes.length === 1);

  // 何も変わらない
  await inbox.continuePrepared(item.id, second, C, runner, extractor, pitcher);
  const third = inbox.getInboxItem(item.id)!;
  check("何も変わらない：会話だけ差し替えて、候補づくりはしない", third.text === C && runs === 2 && third.last_update?.rerun === false && third.last_update.changes.length === 0);
  check("何も変わらない：候補・準備済みの時刻はそのまま、前の候補も増えない", third.status === "ready" && third.finished_at === second.finished_at && third.previous?.length === 1 && third.result?.candidates.length === second.result?.candidates.length);

  // 指名が変わる
  await inbox.continuePrepared(item.id, third, D, runner, extractor, pitcher);
  const fourth = inbox.getInboxItem(item.id)!;
  check("指名が変わる：変わった項目に指名が出て、候補づくりをやり直す", fourth.last_update?.changes.map(C0.changeLine).join("/") === "指名：なし → 芹沢 葵さん" && runs === 3, fourth.last_update?.changes.map(C0.changeLine).join("/"));
  check("指名が変わる：前の候補が2回分残る", fourth.previous?.length === 2 && fourth.nominee?.employee_id !== null);

  // 読み取りの失敗：前のまま
  failNext = true;
  await inbox.continuePrepared(item.id, fourth, `${D}\n\n@LayerX_tech\n確認します。`, runner, extractor, pitcher);
  failNext = false;
  const fifth = inbox.getInboxItem(item.id)!;
  check("読み取りに失敗：会話・候補は前のまま残し、理由を出す", fifth.text === D && fifth.status === "ready" && !!fifth.result && /続きの会話を読み取れませんでした/.test(fifth.continue_error ?? "") && runs === 3, `${fifth.status} ${fifth.continue_error}`);

  // 関所
  await inbox.continuePrepared(item.id, fifth, E, runner, extractor, pitcher);
  const sixth = inbox.getInboxItem(item.id)!;
  check("関所：続きが依頼ではないと読まれたら、候補づくりをせずに止める", sixth.kind === "not_request" && runs === 3 && sixth.result === null);
  check("関所：止めても、前の候補は残る", (sixth.previous?.length ?? 0) === 3);

  // 準備中は更新しない
  const busy = inbox.registerInbox({ text: "@busy_meetup\n「Busy Night」運営です。LT10分をお願いできる方を探しています。テーマはテストです。", source: "manual" });
  const out = inbox.continueInbox(busy.id, "続き", runner, extractor);
  check("準備中の依頼は更新しない", !out.ok && out.error === "準備中です");

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
