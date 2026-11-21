// 仮の受信箱サーバー（①の app/api/inbox ができるまでの動作確認用）。窓口と同じ形を返す。
//   npx tsx scripts/slack/mock-inbox.ts [port]   既定 3999
// 本文で返す結果を変える：「見つからない」→ 候補なし（no_fit）／「エラー」→ error／「遅い」→ ずっと processing／「1人」→ 1人／「5人」→ 5人／それ以外 → 3人
// 準備には READY_AFTER_MS（既定 6秒）かかる。
import http from "node:http";
import type { InboxItem } from "./core";

const port = Number(process.argv[2] ?? 3999);
const READY_AFTER_MS = Number(process.env.MOCK_READY_AFTER_MS ?? 6000);
const items = new Map<string, { at: number; text: string; meta: unknown }>();
let seq = 0;

function view(id: string): InboxItem | null {
  const it = items.get(id);
  if (!it) return null;
  const url = `/?inbox=${id}`;
  if (it.text.includes("遅い") || Date.now() - it.at < READY_AFTER_MS) return { id, status: "processing", url };
  if (it.text.includes("エラー")) return { id, status: "error", url };
  if (it.text.includes("見つからない"))
    return {
      id,
      status: "ready",
      url,
      summary: {
        candidates: [],
        no_fit: { reasons: ["ネタ帳に、このテーマの取り組みを持つカードがありませんでした", "投稿も探しましたが、根拠になるものが見つかりませんでした"] },
      },
    };
  const all = [
    { name: "織部 隼人", confidence: "strong" as const, reason_short: "初登壇｜脆弱性アラートを月400件→50件に減らした本人" },
    { name: "百瀬 結衣", confidence: "strong" as const, reason_short: "初登壇｜初期表示の改善を数字で話せる" },
    { name: "早乙女 蓮", confidence: "conditional" as const, reason_short: "登壇経験あり｜テーマは合うが、今後2週間は勤務時間の5割が予定で埋まっていて準備時間の確認が必要" },
    { name: "東雲 健吾", confidence: "conditional" as const, reason_short: "初登壇｜根拠が1件だけ" },
    { name: "鷹野 未来", confidence: "conditional" as const, reason_short: "半年以内に登壇｜テーマが少しずれる" },
  ];
  const n = it.text.includes("1人") ? 1 : it.text.includes("5人") ? 5 : 3;
  return { id, status: "ready", url, summary: { candidates: all.slice(0, n) } };
}

const server = http.createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const u = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (req.method === "POST" && u.pathname === "/api/inbox") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        const body = JSON.parse(raw) as { text?: string; source?: string; meta?: unknown };
        if (!body.text || body.source !== "slack") return send(400, { error: "text と source が必要です" });
        const id = `inb_${++seq}`;
        items.set(id, { at: Date.now(), text: body.text, meta: body.meta });
        console.log(`[mock-inbox] 受け付け ${id}：${JSON.stringify(body.meta)}`);
        send(200, { id });
      } catch {
        send(400, { error: "JSON ではありません" });
      }
    });
    return;
  }
  const m = u.pathname.match(/^\/api\/inbox\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const v = view(decodeURIComponent(m[1]));
    return v ? send(200, v) : send(404, { error: "見つかりません" });
  }
  send(404, { error: "見つかりません" });
});

server.listen(port, "127.0.0.1", () => console.log(`[mock-inbox] http://127.0.0.1:${port} で待っています`));
