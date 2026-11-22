// 試験用の偽の Anthropic API（手元だけ。本物の API は使わない）。scripts/abuse/fake_api.mjs（いじわる試験）を土台に、
// ふつうに答えるモード（ok）を足したもの。API 層（scripts/test_api.mjs）と E2E 層（e2e/）で使う。
//
//   node scripts/testing/fake_anthropic.mjs <ポート> <モードを書いたファイル> <呼び出しの記録ファイル>
//   または import { startFakeAnthropic } from "./fake_anthropic.mjs"
//
// サーバーを ANTHROPIC_BASE_URL=http://127.0.0.1:<ポート> と、にせのキー（sk-ant-fake-…）で立てると、ここに届く。
// モード（ファイルの中身。試験の途中で書き換えてよい。ファイルがなければ ok）：
//   ok      … それらしく答える（下の「答え方」）
//   429     … 混雑（rate_limit_error）   529 … 過負荷（overloaded_error）   500 … サーバーのエラー
//   hang    … 返事をしない（時間切れの試験）  badjson … 200 だが JSON でない中身
// 返事を遅らせる：setDelay(ms)（import したときだけ。準備中のあいだの操作を確実に試すとき。0 で元に戻す）
//
// 答え方（ok）：届いた要求の形を見て決める。アプリのコードは変えずに、本物と同じ形の返事を返す
//   - 候補を探すループ（tools に submit_candidates）：1回目は最初の指示に出てくるカードを get_card で見る。
//     2回目に、その結果（根拠の取り組み id）だけを使って submit_candidates を呼ぶ。差し戻されたら理由を記録して、文で終える
//   - 会話の読み取り（JSON の形に kind・event_name）：会話から「」のイベント名・日付の一節・LT などを拾う。
//     登壇・LT・依頼・お願いなどの言葉がなければ not_request
//   - それ以外で JSON の形の指定があれば、形どおりの値（文字列は決まった文、null が許されれば null）
//   - 形の指定がなければ、決まった短い文
// 使った分（usage）は毎回 入力1,000・出力500 トークンとして返す（金額の上限の試験に使う）
import fs from "node:fs";
import http from "node:http";
import { pathToFileURL } from "node:url";

export const FAKE_USAGE = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
export const FAKE_TEXT = "（試験用の偽の API の文です）お声がけの下書きです。ご都合をお聞かせください。";

let seq = 0;
const id = (p) => `${p}_fake_${Date.now().toString(36)}_${++seq}`;

function message(model, content, stop_reason = "end_turn") {
  return { id: id("msg"), type: "message", role: "assistant", model: model || "claude-fake", content, stop_reason, stop_sequence: null, usage: FAKE_USAGE };
}
const textBlock = (text) => ({ type: "text", text });
const toolUse = (name, input) => ({ type: "tool_use", id: id("toolu"), name, input });

const userText = (m) =>
  typeof m?.content === "string"
    ? m.content
    : (m?.content ?? [])
        .map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? (typeof b.content === "string" ? b.content : (b.content ?? []).map((x) => x.text ?? "").join("")) : ""))
        .join("\n");

// ---------------------------------------------------------------------------
// 候補を探すループ
// ---------------------------------------------------------------------------
function candidateLoop(body, note) {
  const msgs = body.messages ?? [];
  const first = userText(msgs[0]);
  const assistantTurns = msgs.filter((m) => m.role === "assistant").length;
  const last = msgs[msgs.length - 1];
  const results = Array.isArray(last?.content) ? last.content.filter((b) => b.type === "tool_result") : [];

  // 提出が差し戻された：理由を記録して終える（試験で気づけるように）
  const rejected = results.find((r) => r.is_error && /submit|差し戻|根拠|候補/.test(userText({ content: [r] })));
  if (assistantTurns >= 2 && rejected) {
    note(`rejected: ${userText({ content: [rejected] }).slice(0, 500).replace(/\s+/g, " ")}`);
    return message(body.model, [textBlock("提出を直せませんでした（試験用の偽の API）")]);
  }
  if (assistantTurns >= 4) return message(body.model, [textBlock("ここで終えます（試験用の偽の API）")]);

  // 1回目：最初の指示に出てくるカードを見る（なければ探す）
  if (assistantTurns === 0) {
    const cards = [...new Set(first.match(/card-e\d{3}-\d{2}/g) ?? [])].slice(0, 2);
    if (cards.length) return message(body.model, [textBlock("カードを確かめます"), ...cards.map((c) => toolUse("get_card", { card_id: c }))], "tool_use");
    return message(body.model, [toolUse("search_cards", { query: "" })], "tool_use");
  }

  // 2回目以降：見たカードの根拠だけで提出する
  const seenCards = [];
  for (const r of results) {
    let v;
    try {
      v = JSON.parse(userText({ content: [r] }));
    } catch {
      continue;
    }
    if (v?.card_id && Array.isArray(v.evidence)) seenCards.push(v);
    for (const x of v?.results ?? []) if (x?.card_id && Array.isArray(x.evidence_activity_ids)) seenCards.push({ ...x, evidence: x.evidence_activity_ids });
  }
  const picked = [];
  for (const c of seenCards) {
    const emp = c.employee_id ?? c.card_id.match(/card-(e\d{3})-/)?.[1];
    const ev = c.evidence.map((t) => String(t).split(" ")[0]).filter((x) => /^[a-z]+[-_]?\w*\d/.test(x)).slice(0, 2);
    if (picked.length >= 2) break;
    if (!emp || !ev.length || picked.some((p) => p.employee_id === emp)) continue;
    const theme = (Array.isArray(c.themes) ? c.themes[0] : null) ?? c.theme ?? "取り組みから学んだこと";
    picked.push({
      employee_id: emp,
      card_id: c.card_id,
      theme: typeof theme === "string" ? theme : "取り組みから学んだこと",
      reason: "依頼のテーマに近い取り組みがあり、社外にも話しやすい内容のため",
      evidence_activity_ids: ev,
      cautions: [],
      is_alternative_to_nominee: false,
      confidence: "conditional",
      caveat: "テーマが少しずれるので、話す範囲を本人と確かめたい",
    });
  }
  if (!picked.length && assistantTurns === 1 && !results.some((r) => /search_cards/.test(r.tool_use_id ?? ""))) {
    return message(body.model, [toolUse("search_cards", { query: "" })], "tool_use");
  }
  const submit = {
    request_pattern: "theme_specified",
    summary: "依頼のテーマに近い取り組みがある人を、ネタ帳から選びました",
    nominee_assessment: null,
    learnings_applied: [],
    no_fit: picked.length ? null : { reasons: ["依頼に合う取り組みが見つかりませんでした"], next_checks: ["テーマを広げて探すか、主催者に話してほしい内容を確かめる"] },
    candidates: picked,
  };
  return message(body.model, [toolUse("submit_candidates", submit)], "tool_use");
}

// ---------------------------------------------------------------------------
// JSON の形の指定がある呼び出し
// ---------------------------------------------------------------------------
const REQUEST_WORDS = /登壇|LT|ＬＴ|依頼|お願い|講演|トーク|パネル|寄稿|ご相談|相談/;

function intake(text) {
  const t = text.normalize("NFKC");
  const field = (value, quote) => ({ value: value ?? null, quote: value ? quote ?? value : null });
  const ev = t.match(/「([^」]{2,40})」/);
  const dateQ = t.match(/[^。\n]*?(\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{1,2}月\d{1,2}日)[^。\n]*/);
  let date = null;
  if (dateQ) {
    const m = dateQ[1].match(/(?:(\d{4})[/-])?(\d{1,2})[/月-](\d{1,2})/);
    if (m) date = `${m[1] ?? "2026"}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  const fmt = t.match(/(LT\s*\d*分?|トーク\s*\d*分?|パネル)/);
  const isRequest = REQUEST_WORDS.test(t);
  // 日付の一節は、原文（NFKC 前）にそのままある形で返す（アプリが会話の中にあるかを確かめるため）
  const rawQuote = dateQ ? text.split(/[。\n]/).find((s) => s.normalize("NFKC").includes(dateQ[1])) ?? null : null;
  return {
    event_name: field(ev?.[1] ?? null, ev ? text.match(/「[^」]{2,40}」/)?.[0] ?? null : null),
    date: field(date && rawQuote ? date : null, rawQuote),
    format: field(fmt?.[1]?.trim() ?? null, fmt ? text.split(/[。\n]/).find((s) => /LT|ＬＴ|トーク|パネル/.test(s)) ?? null : null),
    theme: field(null),
    organizer: field(null),
    nominee: field(null),
    date_hint: field(null),
    kind: { value: isRequest ? "request" : "not_request", reason: isRequest ? "登壇の依頼" : "依頼の言葉がない" },
    multiple_requests: false,
    attribute_filter: false,
    competitor_comparison: false,
  };
}

/** 形どおりの値（文字列は決まった文、null が許されれば null、配列は空） */
function fromSchema(s, key = "") {
  if (!s || typeof s !== "object") return null;
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (s.enum) return s.enum[0];
  if (types.includes("object") || s.properties) {
    const o = {};
    for (const [k, v] of Object.entries(s.properties ?? {})) o[k] = fromSchema(v, k);
    return o;
  }
  if (types.includes("null") && !types.includes("string")) return null;
  if (types.includes("array")) return [];
  if (types.includes("string")) return key && /reply|draft|text|body|message|pitch/.test(key) ? FAKE_TEXT : "試験用の文";
  if (types.includes("boolean")) return false;
  if (types.includes("integer") || types.includes("number")) return 0;
  if (types.includes("null")) return null;
  return null;
}

function answer(body, note) {
  const tools = (body.tools ?? []).map((t) => t.name);
  if (tools.includes("submit_candidates")) return candidateLoop(body, note);
  const schema = body.output_config?.format?.type === "json_schema" ? body.output_config.format.schema : null;
  const text = userText((body.messages ?? [])[0]);
  if (schema?.properties?.kind && schema?.properties?.event_name) return message(body.model, [textBlock(JSON.stringify(intake(text)))]);
  if (schema) return message(body.model, [textBlock(JSON.stringify(fromSchema(schema)))]);
  if (tools.length) {
    // ほかのツールのループ（ネタ帳の更新など）は、提出せずに終える（試験では使わない）
    return message(body.model, [textBlock("試験用の偽の API なので、この作業はしません")]);
  }
  return message(body.model, [textBlock(FAKE_TEXT)]);
}

// ---------------------------------------------------------------------------
// サーバー
// ---------------------------------------------------------------------------
export function startFakeAnthropic({ port = 0, modeFile = null, logFile = null } = {}) {
  let memMode = "ok";
  const mode = () => (modeFile && fs.existsSync(modeFile) ? fs.readFileSync(modeFile, "utf-8").trim() || "ok" : memMode);
  const calls = [];
  const notes = [];
  /** 返事を遅らせる長さ（ミリ秒）。準備中のあいだの操作を確実に試すため（setDelay で変える。既定は遅らせない） */
  let delayMs = 0;
  const log = (line) => {
    if (logFile) fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  };
  const err = (res, status, type, msg, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", "request-id": "req_fake", ...headers });
    res.end(JSON.stringify({ type: "error", error: { type, message: msg } }));
  };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const m = mode();
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
      } catch {
        /* 形の崩れた要求 */
      }
      const kind = (body.tools ?? []).some((t) => t.name === "submit_candidates")
        ? "loop"
        : body.output_config?.format?.schema?.properties?.kind
          ? "intake"
          : body.output_config?.format
            ? "json"
            : "text";
      const call = { at: Date.now(), mode: m, method: req.method, url: req.url, kind, key: String(req.headers["x-api-key"] ?? "").slice(0, 12) };
      calls.push(call);
      log(`${m} ${req.method} ${req.url} ${kind}`);
      if (!/\/v1\/messages/.test(req.url ?? "")) return err(res, 404, "not_found_error", "fake: unknown path");
      if (m === "429") return err(res, 429, "rate_limit_error", "fake: rate limited", { "retry-after": "1" });
      if (m === "529") return err(res, 529, "overloaded_error", "fake: overloaded");
      if (m === "500") return err(res, 500, "api_error", "fake: internal error");
      if (m === "badjson") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end("<html>not json</html>");
      }
      if (m === "hang") return; // 返事をしない（つないだまま）
      const out = answer(body, (n) => {
        notes.push(n);
        log(`note ${n}`);
      });
      const send = () => {
        res.writeHead(200, { "content-type": "application/json", "request-id": "req_fake" });
        res.end(JSON.stringify(out));
      };
      if (delayMs > 0) setTimeout(send, delayMs);
      else send();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,
        calls,
        notes,
        setMode: (v) => {
          memMode = v;
          if (modeFile) fs.writeFileSync(modeFile, v);
        },
        /** ok の返事を ms ミリ秒遅らせる（0 で元に戻す）。受け取った時点の長さで遅らせる */
        setDelay: (ms) => {
          delayMs = Math.max(0, Number(ms) || 0);
        },
        close: () => new Promise((r) => {
          server.closeAllConnections?.();
          server.close(() => r());
        }),
      });
    });
  });
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [port, modeFile, logFile] = process.argv.slice(2);
  startFakeAnthropic({ port: Number(port || 3299), modeFile: modeFile || null, logFile: logFile || null }).then((f) => console.log(`fake anthropic on ${f.url}`));
}
