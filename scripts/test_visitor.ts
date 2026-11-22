// 見せる用の「人」の見分け方（lib/visitor.ts）のテスト（API は使わない・data/ に書き込まない）。
//   npx tsx scripts/test_visitor.ts（npm test にも入る）
import "./_isolate";
import { createHash } from "node:crypto";
import { NO_VISITOR, VISITOR_COOKIE, isVisitorKey, newVisitorId, visitorCookieHeader, visitorCookieOf, visitorKey, visitorKeyOf } from "../lib/visitor";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
}

const a = newVisitorId();
const b = newVisitorId();
check("人の印はランダム（毎回ちがう・十分に長い）", a !== b && a.length >= 24 && /^[A-Za-z0-9_-]+$/.test(a));
check("同じ印からは同じ名前、ちがう印からはちがう名前", visitorKey(a) === visitorKey(a) && visitorKey(a) !== visitorKey(b));
check("名前は英数字32文字のハッシュ（印の値そのものは入らない）", /^[0-9a-f]{32}$/.test(visitorKey(a)) && !visitorKey(a).includes(a));
check("①の仮の決め方（sha256(\"netacho-person:\"+印) の先頭32文字）と同じ名前", visitorKey("abc") === createHash("sha256").update("netacho-person:abc").digest("hex").slice(0, 32));
check("印がなければ no-person", visitorKey(null) === NO_VISITOR && visitorKey("  ") === NO_VISITOR);
const req = (cookie?: string) => new Request("http://x/", { headers: cookie ? { cookie } : {} });
check("Cookie ヘッダーから人の印を読む（ほかの cookie と並んでいても）", visitorCookieOf(`nb_access=zzz; ${VISITOR_COOKIE}=${a}; other=1`) === a);
check("要求から名前を決める", visitorKeyOf(req(`nb_access=zzz; ${VISITOR_COOKIE}=${a}`)) === visitorKey(a) && visitorKeyOf(req()) === NO_VISITOR);
check("合言葉の印（全員同じ）だけでは人を分けない", visitorKeyOf(req("nb_access=same")) === NO_VISITOR);
check("壊れた印でも落ちない", visitorKeyOf(req(`${VISITOR_COOKIE}=%E0%A4%A`)) === NO_VISITOR);
check("フォルダ名に使ってよい形か確かめられる（../ などは通さない）", isVisitorKey(visitorKey(a)) && isVisitorKey(NO_VISITOR) && !isVisitorKey("../x") && !isVisitorKey("ABC"));
const h = visitorCookieHeader(a);
check("cookie は httpOnly・SameSite=Strict・12時間", h.startsWith(`${VISITOR_COOKIE}=${a};`) && /HttpOnly/.test(h) && /SameSite=Strict/.test(h) && /Max-Age=43200/.test(h));

console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
process.exit(failed ? 1 : 0);
