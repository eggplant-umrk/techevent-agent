// いじわる試験（docs/abuse_test.md）で見つかった問題の直しのテスト（API は使わない）。
//   npm run test:guard
//   1. 承諾の二重記録・カードの二重作成  2. 生のエラー文  3. 合言葉を続けて間違えたとき
import "./_isolate"; // 元のデータだけで動かす（実行時のデータは一時フォルダ）
import fs from "node:fs";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}

async function main() {
  // ---- 1. 承諾の二重記録 ----
  {
    const { loadCards, getCardById } = await import("../lib/cards");
    const { POST: outcome } = await import("../app/api/outcome/route");
    const { POST: undo } = await import("../app/api/outcome/undo/route");
    const H = { host: "localhost:3000", "content-type": "application/json" };
    const post = (body: object) => outcome(new Request("http://localhost:3000/api/outcome", { method: "POST", headers: H, body: JSON.stringify(body) }));
    const REQ = "req004"; // 指名の依頼（本人 e002）
    const cand = { employee_id: "e002", theme: "指名のテーマ", reason: "指名の本人", evidence_activity_ids: [] };
    const e002Before = loadCards().filter((c) => c.employee_id === "e002").length;

    // カードのない候補（指名の本人）を、2つのタブで同時に承認
    const rs = await Promise.all([1, 2, 3].map(() => post({ request_id: REQ, card_id: null, result: "approved", candidate: cand })));
    const e002 = loadCards().filter((c) => c.employee_id === "e002");
    const made = e002.filter((c) => c.outreach_history.some((h) => h.request_id === REQ));
    check("カードのない候補を同時に3回承認しても、カードは1枚だけ作る", rs.every((r) => r.status === 200) && e002.length === e002Before + 1 && made.length === 1, `${e002.length - e002Before}枚`);
    const cardId = made[0]?.card_id ?? "";
    const hist = () => (getCardById(cardId)?.outreach_history ?? []).filter((h) => h.request_id === REQ).map((h) => h.result);
    check("そのカードの「声かけ」は1件だけ", hist().join(",") === "approved", hist().join(","));

    // 同じ人の承諾を5回同時
    const acc = await Promise.all([1, 2, 3, 4, 5].map(() => post({ request_id: REQ, card_id: cardId, result: "accepted" })));
    check("同じ人の承諾を5回同時に押しても、承諾は1件だけ", acc.every((r) => r.status === 200) && hist().join(",") === "approved,accepted", hist().join(","));
    const dupFlags = await Promise.all(acc.map((r) => r.json() as Promise<{ duplicate?: boolean }>));
    check("2回目からは「すでに同じ記録がある」として返す（エラーにはしない）", dupFlags.filter((j) => j.duplicate).length === 4);

    // 取り消し1回で、承諾済みでなくなる
    const u = await undo(new Request("http://localhost:3000/api/outcome/undo", { method: "POST", headers: H, body: JSON.stringify({ request_id: REQ, card_id: cardId }) }));
    check("「承諾を取り消す」を1回押せば、声かけ中に戻る", u.status === 200 && hist().join(",") === "approved", hist().join(","));

    // 違う結果は足す・辞退は理由まで同じときだけまとめる
    await post({ request_id: REQ, card_id: cardId, result: "declined", reason: "busy" });
    await post({ request_id: REQ, card_id: cardId, result: "declined", reason: "busy" });
    await post({ request_id: REQ, card_id: cardId, result: "declined", reason: "schedule_conflict" });
    check("違う結果（辞退）は足す。同じ理由の辞退は1件、理由が違えば足す", hist().join(",") === "approved,declined,declined", hist().join(","));
    await post({ request_id: REQ, card_id: cardId, result: "accepted" });
    check("辞退のあとの承諾は足す（最後の記録と違うので）", hist().at(-1) === "accepted");

    // カードのある候補：別の依頼なら同じ人でも足す
    const other = "card-e011-01";
    const before = getCardById(other)!.outreach_history.length;
    await post({ request_id: "req001", card_id: other, result: "approved" });
    await post({ request_id: "req002", card_id: other, result: "approved" });
    check("別の依頼の声かけは、同じカードでも足す", getCardById(other)!.outreach_history.length === before + 2);

    // 4. JSON でない本文は 400（この窓口は 1 で触ったので、ここで確かめる）
    const bad = await outcome(new Request("http://localhost:3000/api/outcome", { method: "POST", headers: H, body: "これはJSONではない" }));
    const badJson = (await bad.json().catch(() => null)) as { error?: string } | null;
    check("結果の記録：JSON でない本文は 400 と「送られた内容が読めません」", bad.status === 400 && badJson?.error === "送られた内容が読めません", `${bad.status}`);
  }

  // ---- 4. JSON でない本文・形の違う本文は 400（docs/abuse_test.md の3つの窓口） ----
  {
    const H = { host: "localhost:3000", "content-type": "application/json" };
    const { PATCH: cardsPatch } = await import("../app/api/cards/route");
    const { POST: pending } = await import("../app/api/cards/pending/route");
    const { POST: agent } = await import("../app/api/agent/route");
    const { POST: outcome } = await import("../app/api/outcome/route");
    const call = async (name: string, fn: (r: Request) => Promise<Response>, url: string, method: string, body: string) => {
      const r = await fn(new Request(`http://localhost:3000${url}`, { method, headers: H, body }));
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      check(`${name}`, r.status === 400 && j?.error === "送られた内容が読めません", `${r.status} ${j?.error ?? "（本文なし）"}`);
    };
    await call("カードを直す（PATCH /api/cards）：JSON でない本文は 400", cardsPatch, "/api/cards", "PATCH", "{壊れた");
    await call("カードを直す：形の違う本文（patch が文字列）は 400", cardsPatch, "/api/cards", "PATCH", JSON.stringify({ card_id: "card-e011-01", patch: "x" }));
    await call("カードを直す：テーマが文字列の並びでなければ 400", cardsPatch, "/api/cards", "PATCH", JSON.stringify({ card_id: "card-e011-01", patch: { themes: [1, 2] } }));
    await call("候補づくり（/api/agent）：JSON でない本文は 400", agent, "/api/agent", "POST", "request_id=req001");
    await call("候補づくり：request_id が文字列でなければ 400", agent, "/api/agent", "POST", JSON.stringify({ request_id: 12 }));
    await call("結果の記録（/api/outcome）：空の本文は 400", outcome, "/api/outcome", "POST", "");
    await call("結果の記録：candidate の形が違えば 400", outcome, "/api/outcome", "POST", JSON.stringify({ request_id: "req001", card_id: null, result: "approved", candidate: { employee_id: "e002", theme: 3 } }));
    await call("新しいテーマ案（/api/cards/pending）：JSON でない本文は 400", pending, "/api/cards/pending", "POST", "null");
    const ok = await cardsPatch(new Request("http://localhost:3000/api/cards", { method: "PATCH", headers: H, body: JSON.stringify({ card_id: "card-e011-01", patch: { summary: "直した要約" } }) }));
    check("正しい本文は今までどおり通る", ok.status === 200, `${ok.status}`);
  }

  // ---- 5. 同じ会話の重複：足さずに、受信箱にある依頼を開く ----
  {
    const { registerInbox, listInbox } = await import("../lib/inbox");
    const { findActiveDuplicate } = await import("../lib/board");
    const { POST: inboxPost } = await import("../app/api/inbox/route");
    const text = "@organizer 来月のLT会でLayerXさんの枠を1つ用意しています！\n12月18日（金）19時からです。テーマは自由です。";
    const first = registerInbox({ text, source: "manual" }); // 候補づくりは始めない（API を使わない）
    const n = listInbox().length;
    const again = await inboxPost(
      new Request("http://localhost:3000/api/inbox", {
        method: "POST",
        headers: { host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ text: `  ${text.replace("\n", "\r\n\r\n")}　 `, source: "manual" }),
      }),
    );
    const j = (await again.json()) as { id?: string; duplicate?: boolean };
    check("同じ文（空白・改行の違いだけ）を貼り直したら、足さずに前の依頼を返す", again.status === 200 && j.id === first.id && j.duplicate === true && listInbox().length === n, JSON.stringify(j));
    const slack = await inboxPost(
      new Request("http://localhost:3000/api/inbox", {
        method: "POST",
        headers: { host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ text, source: "slack", meta: { channel: "C1", ts: "1.2" } }),
      }),
    );
    const sj = (await slack.json()) as { id?: string; duplicate?: boolean };
    check("Slack から同じ文が来ても足さない（連投）", sj.id === first.id && sj.duplicate === true && listInbox().length === n);
    check("違う文は重複にしない", findActiveDuplicate(text + "\n会場は渋谷です。") === null);
    const past = registerInbox({ text: "LT会のご依頼です。2026年10月2日（金）19時から、テーマは自由です。", source: "manual" });
    check("開催日が過ぎた依頼（アーカイブ）と同じ文なら、重複にしない（新しく足す）", findActiveDuplicate(past.text) === null);
    const page = fs.readFileSync(path.join(process.cwd(), "app", "page.tsx"), "utf-8");
    check("画面：同じ依頼のときは、その依頼を開いて「同じ依頼がもうあります」と出す", page.includes("同じ依頼がもうあります") && /if \(duplicate\) setDupNotice/.test(page));
    const mock = fs.readFileSync(path.join(process.cwd(), "app", "_client", "mock.ts"), "utf-8");
    check("?mock でも同じ動き", mock.includes("duplicate: true"));
  }

  // ---- 6. フォント：Google Fonts から取らず、手元のファイルを使う ----
  {
    const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf-8");
    const layout = read("app/layout.tsx");
    check("画面は Google Fonts（next/font/google）を使わない", !layout.includes("next/font/google") && layout.includes('import "./fonts.css"'));
    const css = read("app/fonts.css");
    const urls = [...css.matchAll(/url\("\/fonts\/([^"]+)"\)/g)].map((m) => m[1]);
    const missing = urls.filter((u) => !fs.existsSync(path.join(process.cwd(), "public", "fonts", u)));
    check("フォントのファイルは手元（public/fonts/）にあり、外の URL を読まない", urls.length > 100 && !missing.length && !/https?:\/\//.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), `${urls.length}件・足りない${missing.length}件`);
    check("Inter と Noto Sans JP の両方がある", /font-family:"Inter"/.test(css) && /font-family:"Noto Sans JP"/.test(css));
    const g = read("app/globals.css");
    check("読めないときは端末の文字で出す（font-family の最後に端末の文字）", /font-family: "Inter", "Noto Sans JP", [^;]*system-ui, sans-serif;/.test(g) && !g.includes("var(--font-"));
    const src = [layout, g, read("next.config.ts")].join("\n");
    check("どこからも fonts.googleapis.com・fonts.gstatic.com を読まない", !/fonts\.(googleapis|gstatic)\.com/.test(src));
    const { config } = await import("../proxy");
    check("フォントは入口（合言葉）を通さずに読める（合言葉の画面でもフォントが出る）", config.matcher.some((m: string) => m.includes("fonts/")));
  }

  // ---- 2. 生のエラー文 ----
  {
    const { userErrorText, apiErrorKind } = await import("../lib/userError");
    const logged: string[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void logged.push(a.join(" "));
    const apiErr = (status: number, body: string) => Object.assign(new Error(`${status} ${body}`), { status });
    const raw529 = apiErr(529, '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
    const t529 = userErrorText(raw529, { where: "候補づくり", retryLabel: "もう一度探す" });
    check("529（混雑）は「AI が混んでいます。少し待ってから『もう一度探す』を押してください」", t529 === "AI が混んでいます。少し待ってから「もう一度探す」を押してください", t529);
    check("画面の文に生の文（529・JSON・英語）を入れない", !/529|\{|overloaded/i.test(t529));
    check("生の文はサーバーの記録にだけ残す", logged.some((l) => l.includes("候補づくり") && l.includes("overloaded_error")));
    const cases: Array<[unknown, string]> = [
      [apiErr(429, '{"type":"error","error":{"type":"rate_limit_error"}}'), "AI の利用が一時的に混み合っています"],
      [apiErr(500, '{"type":"error","error":{"type":"api_error"}}'), "AI の側で一時的な問題が起きています"],
      [new Error('529 {"type":"error","error":{"type":"overloaded_error"}}'), "AI が混んでいます"],
      [Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }), "AI から返事が届きませんでした"],
      [new Error("Connection error."), "AI から返事が届きませんでした"],
      [new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"), "AI の返事を読み取れませんでした"],
      [apiErr(401, '{"type":"error","error":{"type":"authentication_error"}}'), "AI につなぐ設定に問題がある"],
      [new Error("something odd happened"), "うまくいきませんでした"],
    ];
    for (const [e, want] of cases) {
      const got = userErrorText(e);
      check(`言い換え：${(e as Error).message.slice(0, 40)}`, got.includes(want) && !/\{"/.test(got), got);
    }
    const own = "上限（$0.5）に届いたので、API を使う操作を止めています";
    check("アプリの日本語の理由は、そのまま出す", userErrorText(new Error(own)) === own);
    check("日本語に JSON の文字が入っていても、アプリの理由として扱う", apiErrorKind(new Error("送られた内容が読めません")) === null || userErrorText(new Error("送られた内容（JSON）が読めません")) === "送られた内容（JSON）が読めません");
    console.error = orig;

    // 画面に出る窓口が、生の err.message を返していないか（コードを読んで確かめる）
    const files = [
      "app/api/agent/route.ts",
      "app/api/blog-ideas/route.ts",
      "app/api/draft/route.ts",
      "app/api/events/[id]/analyze/route.ts",
      "app/api/notebook/route.ts",
      "app/api/venues/draft/route.ts",
      "app/api/venues/route.ts",
    ];
    const rawLeft = files.filter((f) => /err instanceof Error \? err\.message/.test(fs.readFileSync(path.join(process.cwd(), f), "utf-8")));
    check("API を使う窓口は、エラーを使う人向けの文にして返す", !rawLeft.length, rawLeft.join(", "));
    const inboxSrc = fs.readFileSync(path.join(process.cwd(), "lib", "inbox.ts"), "utf-8");
    check("受信箱の候補づくりの失敗も、使う人向けの文で保存する", inboxSrc.includes('userErrorText(err, { where: "受信箱の候補づくり"'));
    const apiSrc = fs.readFileSync(path.join(process.cwd(), "app", "_client", "api.ts"), "utf-8");
    check("画面：サーバーにつながらないときも英語（Failed to fetch）を出さない", apiSrc.includes("サーバーにつながりませんでした") && !/[^e]fetch\("/.test(apiSrc.replace(/safeFetch\(/g, "")));
  }

  // ---- 3. 合言葉を続けて間違えたら、しばらく受け付けない ----
  {
    process.env.SHARE_MODE = "lan";
    process.env.ACCESS_CODE = "sakura-2026-hanami";
    process.env.SHARE_BUDGET_USD = "5";
    const guard = await import("../lib/accessGuard");
    guard.clearAccessGuard();
    const { POST: access } = await import("../app/api/access/route");
    const tryCode = (code: string, ip = "192.168.1.50") =>
      access(new Request("http://192.168.1.20:3000/api/access", { method: "POST", headers: { "x-forwarded-for": ip }, body: JSON.stringify({ code }) }));
    const st: number[] = [];
    for (let i = 0; i < 4; i++) st.push((await tryCode("nope")).status);
    check("4回までは 401（合言葉が違います）", st.every((s) => s === 401), st.join(","));
    const fifth = await tryCode("nope");
    const fifthJson = (await fifth.json()) as { error: string };
    check("5回目で受け付けなくなる（429・待つ時間つき）", fifth.status === 429 && /5分ほど待って/.test(fifthJson.error), `${fifth.status} ${fifthJson.error}`);
    const right = await tryCode("sakura-2026-hanami");
    check("受け付けない間は、正しい合言葉でも入れない", right.status === 429 && !right.headers.get("set-cookie"));
    const elsewhere = await tryCode("sakura-2026-hanami", "192.168.1.51");
    check("ほかのところ（別の端末）は入れる", elsewhere.status === 200);
    const key = guard.accessSourceKey("192.168.1.50");
    const later = Date.now() + guard.ACCESS_LOCK_MS + 1000;
    check("5分たてば受け付ける", guard.accessLockedMs(key, later) === 0 && guard.accessLockedMs(key) > 0);

    // 間違いが5分にまたがってばらばらなら、数えない
    guard.clearAccessGuard();
    const k2 = "10.0.0.9";
    const t0 = Date.now();
    for (let i = 0; i < 4; i++) guard.noteAccessFailure(k2, t0 + i * 1000);
    const lockedLate = guard.noteAccessFailure(k2, t0 + guard.ACCESS_FAIL_WINDOW_MS + 10_000);
    check("5分より前の間違いは数えない（ときどき打ち間違えるだけなら止めない）", !lockedLate);
    // 正しく入れたら回数を戻す
    guard.clearAccessGuard();
    for (let i = 0; i < 4; i++) await tryCode("nope", "192.168.1.60");
    await tryCode("sakura-2026-hanami", "192.168.1.60");
    const afterOk = await tryCode("nope", "192.168.1.60");
    check("正しく入れたら回数を戻す（そのあと1回間違えても 401）", afterOk.status === 401);

    // 入口（proxy.ts）：ヘッダーで送る合言葉も同じに数える
    guard.clearAccessGuard();
    const { proxy } = await import("../proxy");
    const { NextRequest } = await import("next/server");
    const via = (code: string, ip = "192.168.1.70") =>
      proxy(new NextRequest("http://192.168.1.20:3000/api/cards", { headers: { host: "192.168.1.20:3000", "x-access-code": code, "x-forwarded-for": ip } }));
    const hs = [1, 2, 3, 4].map(() => via("nope").status);
    const h5 = via("nope");
    const h6 = via("sakura-2026-hanami");
    check("入口：ヘッダーの合言葉も、4回までは 401、5回目から 429", hs.every((s) => s === 401) && h5.status === 429 && h6.status === 429, `${hs.join(",")},${h5.status},${h6.status}`);
    check("入口：ほかのところは、正しい合言葉で通る", via("sakura-2026-hanami", "192.168.1.71").headers.get("x-middleware-next") === "1");
    delete process.env.SHARE_MODE;
    delete process.env.ACCESS_CODE;
    delete process.env.SHARE_BUDGET_USD;
    guard.clearAccessGuard();
  }

  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
