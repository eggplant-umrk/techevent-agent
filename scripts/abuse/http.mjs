// いじわる試験（画面の操作）：連打・2つのタブ・取り消しのくり返しを、窓口に直接投げて確かめる。
//   node scripts/abuse/http.mjs [http://127.0.0.1:3200]
// 相手は、一時フォルダを置き場にして立てた確認用のサーバー（3000番・3100番には投げない）。API キーなしで動かす（本物の API は呼ばれない）。
// 結果は標準出力に JSON の行で出す（docs/abuse_test.md にまとめる）。
const BASE = process.argv[2] || "http://127.0.0.1:3200";
if (/:(3000|3100)(\/|$)/.test(BASE)) {
  console.error("3000番・3100番には投げません");
  process.exit(1);
}
const j = async (method, path, body) => {
  const t = Date.now();
  try {
    const res = await fetch(BASE + path, { method, headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* NDJSON や HTML */
    }
    return { status: res.status, ms: Date.now() - t, data, text: text.slice(0, 300) };
  } catch (e) {
    return { status: 0, ms: Date.now() - t, data: null, text: String(e) };
  }
};
const out = (name, value) => console.log(JSON.stringify({ test: name, ...value }));
const statuses = (rs) => rs.map((r) => r.status).join(",");
const card = async (id) => (await j("GET", "/api/cards")).data?.cards?.find((c) => c.card_id === id);
const history = async (id, req) => ((await card(id))?.outreach_history ?? []).filter((h) => h.request_id === req).map((h) => h.result);
const state = async (req) => {
  const d = (await j("GET", `/api/inbox/${req}/detail`)).data;
  return d ? { stage: d.state?.stage, accepted_by: (d.state?.accepted_by ?? []).map((p) => p.name), outreach_to: (d.state?.outreach_to ?? []).map((p) => p.name), declined_by: (d.state?.declined_by ?? []).map((p) => p.name) } : null;
};
const outcome = (req, cardId, result, extra = {}) => j("POST", "/api/outcome", { request_id: req, card_id: cardId, result, ...extra });
const undo = (req, cardId) => j("POST", "/api/outcome/undo", { request_id: req, card_id: cardId });

// ---- 1. 「この人で進める」の連打（同じ人を8回同時に承認）
let rs = await Promise.all(Array.from({ length: 8 }, () => outcome("req001", "card-e013-01", "approved")));
out("1-1 承認を8回同時", { statuses: statuses(rs), history: await history("card-e013-01", "req001"), state: await state("req001") });

// ---- 2. 承諾の連打（5回同時）
rs = await Promise.all(Array.from({ length: 5 }, () => outcome("req001", "card-e013-01", "accepted")));
out("1-2 承諾を5回同時", { statuses: statuses(rs), history: await history("card-e013-01", "req001"), state: await state("req001") });

// ---- 3. 取り消しを1回 → まだ承諾済みのままか（承諾が重なって記録されていると、1回では戻らない）
rs = [await undo("req001", "card-e013-01")];
out("1-3 重なった承諾を1回取り消す", { statuses: statuses(rs), history: await history("card-e013-01", "req001"), state: await state("req001") });

// ---- 4. 承諾 → 取り消しを5回くり返す（別の依頼・別のカードで、きれいな状態から）
await outcome("req002", "card-e013-01", "approved");
const loop = [];
for (let i = 0; i < 5; i++) {
  const a = await outcome("req002", "card-e013-01", "accepted");
  const u = await undo("req002", "card-e013-01");
  loop.push(`${a.status}/${u.status}`);
}
out("1-4 承諾→取り消しを5回", { statuses: loop.join(" "), history: await history("card-e013-01", "req002"), state: await state("req002") });
// 取り消しをもう1回（承諾がない状態で）、取り消しを2回同時
rs = [await undo("req002", "card-e013-01")];
out("1-5 承諾がないのに取り消す", { statuses: statuses(rs), error: rs[0].data?.error, history: await history("card-e013-01", "req002") });
await outcome("req002", "card-e013-01", "accepted");
rs = await Promise.all([undo("req002", "card-e013-01"), undo("req002", "card-e013-01")]);
out("1-6 取り消しを2回同時", { statuses: statuses(rs), history: await history("card-e013-01", "req002"), state: await state("req002") });

// ---- 5. 2つのタブ：同じ人に、片方は承諾・片方は辞退を同時に
await outcome("req003", "card-e015-01", "approved");
rs = await Promise.all([outcome("req003", "card-e015-01", "accepted"), outcome("req003", "card-e015-01", "declined", { reason: "busy" })]);
out("2-1 2つのタブで承諾と辞退を同時", { statuses: statuses(rs), history: await history("card-e015-01", "req003"), state: await state("req003") });

// ---- 6. 2つのタブ：別々の人を同時に承諾（1つの依頼に2人が承諾済みになるか）
await Promise.all([outcome("req005", "card-e024-01", "approved")]);
rs = await Promise.all([outcome("req005", "card-e024-01", "accepted"), outcome("req005", null, "accepted", { candidate: { employee_id: "e007", theme: "クラウドの権限の棚卸し", reason: "指名された本人", evidence_activity_ids: [] } })]);
out("2-2 2つのタブで別々の人を承諾", { statuses: statuses(rs), errors: rs.map((r) => r.data?.error ?? null), state: await state("req005") });

// ---- 7. カードのない候補（指名の本人）を2回同時に承認 → カードが2枚できるか
rs = await Promise.all([1, 2].map(() => outcome("req004", null, "approved", { candidate: { employee_id: "e002", theme: "チームづくり", reason: "指名された本人", evidence_activity_ids: [] } })));
const e002 = ((await j("GET", "/api/cards")).data?.cards ?? []).filter((c) => c.employee_id === "e002").map((c) => `${c.card_id}(${c.outreach_history.length})`);
out("2-3 カードのない候補を2回同時に承認", { statuses: statuses(rs), cards_of_e002: e002 });

// ---- 8. 2つのタブ：同じカードを別々の中身で同時に直す／別々のカードを同時に直す
rs = await Promise.all([
  j("PATCH", "/api/cards", { card_id: "card-e016-01", patch: { summary: "タブAが直した要約" } }),
  j("PATCH", "/api/cards", { card_id: "card-e016-01", patch: { themes: ["タブBが直したテーマ"] } }),
  j("PATCH", "/api/cards", { card_id: "card-e014-01", patch: { summary: "タブCが直した要約" } }),
]);
const c16 = await card("card-e016-01");
const c14 = await card("card-e014-01");
out("2-4 同じカード・別のカードを同時に直す", { statuses: statuses(rs), e016: { summary: c16?.summary?.slice(0, 20), theme: c16?.themes?.[0]?.slice(0, 20) }, e014: c14?.summary?.slice(0, 20) });

// ---- 9. 形の崩れた入力（JSON でない・項目が足りない・型が違う）
rs = [
  await j("POST", "/api/outcome", "これは JSON ではない"),
  await j("POST", "/api/outcome", {}),
  await j("POST", "/api/outcome", { request_id: "req001", card_id: "card-xxx", result: "accepted" }),
  await j("PATCH", "/api/cards", { card_id: "card-e014-01", patch: { summary: 12345 } }),
  await j("PATCH", "/api/cards", "x"),
  await j("POST", "/api/cards/pending", {}),
  await j("POST", "/api/draft", "x"),
  await j("POST", "/api/agent", "x"),
  await j("GET", "/api/inbox/inb-nai/detail"),
];
out("9 形の崩れた入力", { statuses: statuses(rs), bodies: rs.map((r) => (r.data?.error ?? r.text).slice(0, 60)) });

// ---- 10. 会話を貼って追加を5回同時（同じ文）。キーがないので候補づくりは失敗する（失敗のしかたを見る）
const text = "「Abuse Test Night」運営の者です。12月18日（金）19時〜、LT10分をお願いできる方を探しています。";
rs = await Promise.all(Array.from({ length: 5 }, () => j("POST", "/api/inbox", { text, source: "manual" })));
const ids = rs.map((r) => r.data?.id).filter(Boolean);
out("10-1 同じ会話を5回同時に追加", { statuses: statuses(rs), errors: rs.map((r) => r.data?.error ?? null).filter(Boolean).map((e) => e.slice(0, 50)), accepted: ids.length });
await new Promise((r) => setTimeout(r, 4000));
const list = (await j("GET", "/api/inbox")).data?.items ?? [];
const mine = list.filter((x) => ids.includes(x.id));
out("10-2 4秒後の状態", { items: mine.map((x) => `${x.status}/${x.state?.stage}`), errors: [...new Set(mine.map((x) => x.error).filter(Boolean))].map((e) => e.slice(0, 90)) });

// ---- 11. 「ネタ帳を更新」を3回同時、「ネタ帳から候補を出す」を3回同時（キーなし）
rs = await Promise.all(Array.from({ length: 3 }, () => j("POST", "/api/notebook", {})));
out("11-1 ネタ帳を更新を3回同時", { statuses: statuses(rs), bodies: rs.map((r) => (r.data?.error ?? r.text).replace(/\s+/g, " ").slice(0, 120)) });
rs = await Promise.all(Array.from({ length: 3 }, () => j("POST", "/api/agent", { request_id: "req001" })));
out("11-2 候補を出すを3回同時", { statuses: statuses(rs), bodies: rs.map((r) => (r.data?.error ?? r.text).replace(/\s+/g, " ").slice(0, 120)) });
// そのあと、空きが戻っているか（失敗のあとに枠が返らないと、以後ずっと 429 になる）
await new Promise((r) => setTimeout(r, 1500));
rs = [await j("POST", "/api/agent", { request_id: "req001" })];
out("11-3 失敗のあと、もう一度押せるか", { statuses: statuses(rs), body: (rs[0].data?.error ?? rs[0].text).replace(/\s+/g, " ").slice(0, 120) });
// 候補を出すのに失敗したあと、保存済みの候補が消えていないか
out("11-4 失敗のあとも、前の候補が残っているか", { candidates: ((await j("GET", "/api/inbox/req001/detail")).data?.result?.candidates ?? []).length });
