// Slack の受け取りの関所の試験（npm test に入る）。Slack には投稿しない。受け取る処理（scripts/slack/core.ts の makeMessageHandler）に
// 偽の投稿を渡し、偽の Slack に返した文と、依頼の処理（受信箱へ）に回したかを見る。API・受信箱のサーバーは使わない。
import { DUPLICATE_WINDOW_MS, makeMessageHandler, type BotConfig, type MessageEventLike, type SlackLike, THREAD_TEXT, type ThreadKind } from "./slack/core";

const CH = "C0REQUESTS";
const TEAM = "T0PRACTICE";
const BOT = "U0BOT";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

type Env = { replies: Array<{ ts: string; kind: ThreadKind; text: string }>; handled: Array<{ ts: string; text: string }>; clock: { t: number } };
function setup(opts: { allowedTeam?: string | null; accept?: boolean } = {}) {
  const env: Env = { replies: [], handled: [], clock: { t: Date.parse("2026-11-22T10:00:00+09:00") } };
  const slack: SlackLike = {
    replyInThread: async (ts, kind) => {
      env.replies.push({ ts, kind, text: THREAD_TEXT[kind] });
      return { ok: true };
    },
    notifyPrivate: async () => null,
    getPermalink: async () => null,
  };
  const cfg: BotConfig = {
    channel: CH,
    botUserId: BOT,
    allowedTeam: opts.allowedTeam === undefined ? TEAM : opts.allowedTeam,
    inboxBaseUrl: "http://127.0.0.1:1",
    pollIntervalMs: 1,
    pollTimeoutMs: 1,
    log: () => undefined,
  };
  const accept = opts.accept ?? true;
  const on = makeMessageHandler(
    slack,
    cfg,
    async (e) => {
      env.handled.push({ ts: e.ts, text: e.text });
      return accept;
    },
    () => env.clock.t,
  );
  return { env, on };
}
let n = 0;
const post = (over: Partial<MessageEventLike> = {}): MessageEventLike => ({ type: "message", channel: CH, team: TEAM, user: "U0ORG", text: "LT枠の登壇者を探しています。テーマは認証まわりです", ts: `100.${++n}`, ...over });
const tick = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  // ---- 1. 画像・ファイルつきの投稿
  {
    const { env, on } = setup();
    const r = await on(post({ subtype: "file_share", files: [{ id: "F1", name: "flyer.png" }] }));
    check("ファイルつき・本文あり：本文を依頼として受け付ける", r === "handled" && env.handled.length === 1 && env.replies.length === 0);
    check("ファイルつき：依頼の処理に渡すのは本文だけ（ファイルは渡さない）", JSON.stringify(env.handled[0]).includes("認証") && !JSON.stringify(env.handled[0]).includes("flyer"));
    const r2 = await on(post({ subtype: "file_share", files: [{ id: "F2" }], text: "" }));
    check("ファイルだけ（本文なし）：受け付けない・返信もしない", r2 === "ignored" && env.handled.length === 1 && env.replies.length === 0);
    const r3 = await on(post({ subtype: "message_changed" }));
    check("編集など、ほかの subtype は今までどおり無視", r3 === "ignored");
  }

  // ---- 2. URL だけ・スタンプだけ
  {
    const { env, on } = setup();
    const cases: Array<[string, string]> = [
      ["URL だけ（Slack の書き方）", "<https://example.com/events/123>"],
      ["URL だけ（ラベルつき）", "<https://example.com/events/123|example.com>"],
      ["スタンプだけ", ":pray:"],
      ["スタンプ2つ", ":pray: :bow:"],
      ["メンションだけ", "<@U0SOMEONE>"],
      ["記号だけ", "！！？"],
    ];
    for (const [name, text] of cases) {
      const before = env.handled.length;
      const r = await on(post({ text }));
      const last = env.replies.at(-1);
      check(`${name}：受信箱に入れず、決まった文を返す`, r === "no_request" && env.handled.length === before && last?.text === "依頼の文が見つかりませんでした");
    }
    const ok = await on(post({ text: "<https://example.com/e/1> このイベントで LT をお願いしたいです :pray:" }));
    check("URL・スタンプがあっても、依頼の文があれば受け付ける", ok === "handled");
  }

  // ---- 3. 同じ文の連投
  {
    const { env, on } = setup();
    const text = "12/15の勉強会でLTをお願いできる方はいますか";
    await on(post({ text }));
    env.clock.t += 3 * 60_000;
    const r2 = await on(post({ text: `${text} ` }));
    check("同じ人・同じ文が10分以内：新しく足さず、決まった文を返す", r2 === "duplicate" && env.handled.length === 1 && env.replies.at(-1)?.text === "同じ依頼を受け付けています");
    const r3 = await on(post({ text, user: "U0OTHER" }));
    check("別の人の同じ文は受け付ける", r3 === "handled" && env.handled.length === 2);
    const r4 = await on(post({ text: "12/16の勉強会でLTをお願いできる方はいますか" }));
    check("同じ人の別の文は受け付ける", r4 === "handled" && env.handled.length === 3);
    env.clock.t += DUPLICATE_WINDOW_MS;
    const r5 = await on(post({ text }));
    check("10分を過ぎたら、同じ文でも受け付ける", r5 === "handled" && env.handled.length === 4);
    const same = post({ text: "再送の確認です。LT をお願いします" });
    await on(same);
    const r6 = await on({ ...same });
    check("同じ投稿の再送（ts が同じ）は、今までどおり返信もしない", r6 === "resent" && env.replies.filter((x) => x.ts === same.ts).length === 0);
  }
  {
    const { env, on } = setup({ accept: false });
    const text = "受信箱に入れられなかった依頼です。LT をお願いします";
    await on(post({ text }));
    await tick();
    const r = await on(post({ text }));
    check("受信箱に入れられなかった依頼の投稿し直しは、連投扱いにしない", r === "handled" && env.handled.length === 2);
  }

  // ---- 4. ワークスペースの確認（投稿ごと）
  {
    const { env, on } = setup();
    const r1 = await on(post({ team: "T0OTHERCO" }));
    check("別のワークスペースの投稿：何も返さず無視", r1 === "ignored" && env.replies.length === 0 && env.handled.length === 0);
    const r2 = await on(post({ team: undefined }));
    check("ワークスペースが分からない投稿も無視", r2 === "ignored" && env.replies.length === 0);
    const r3 = await on(post({ team: "T0OTHERCO", text: ":pray:" }));
    check("別のワークスペースなら、依頼の文がなくても返信しない", r3 === "ignored" && env.replies.length === 0);
    const r4 = await on(post());
    check("許可したワークスペースの投稿は受け付ける", r4 === "handled");
  }
  {
    const { on } = setup({ allowedTeam: null });
    check("SLACK_ALLOWED_TEAM_ID がなければ、今までどおり team を見ない", (await on(post({ team: undefined }))) === "handled");
  }

  // ---- スレッドに返す文は決まった文だけ
  {
    const { env, on } = setup();
    await on(post({ text: ":pray:" }));
    const t = "織部さんに12/15のLTをお願いしたいです";
    await on(post({ text: t }));
    await on(post({ text: t }));
    check("返した文はすべて THREAD_TEXT のどれか", env.replies.every((x) => (Object.values(THREAD_TEXT) as string[]).includes(x.text)));
    check("返した文に依頼の中身・人の名前が入らない", env.replies.every((x) => !/織部|12\/15|LT/.test(x.text)));
    check("THREAD_TEXT に値を埋め込まない", Object.values(THREAD_TEXT).every((x) => !/\$\{/.test(x)));
  }

  console.log(failed === 0 ? "\nすべて合格" : `\n${failed}件 不合格`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
