// 合言葉を打たずに入るリンク（/join?code=…）と、発表用の画面（/share-links）のテスト（API は使わない）。npm run test:join
//   合言葉の値は、このテストの出力に出さない（結果の文に値を入れない）
import "./_isolate";
import fs from "node:fs";
import path from "node:path";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "○" : "×"} ${name}${detail ? `：${detail}` : ""}`);
  if (!ok) failed++;
}
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf-8");
const CODE = "join-general-code-test";
const MENTOR = "join-mentor-code-test";
/** 出力に合言葉が混ざらないように、値を伏せてから見せる */
const hide = (s: string) => s.split(CODE).join("（一般の合言葉）").split(MENTOR).join("（メンターの合言葉）");

async function main() {
  process.env.SHARE_MODE = "lan";
  process.env.ACCESS_CODE = CODE;
  process.env.MENTOR_ACCESS_CODE = MENTOR;
  process.env.SHARE_BUDGET_USD = "5";
  process.env.SHARE_PER_PERSON_USD = "5";
  const share = await import("../lib/share");
  const guard = await import("../lib/accessGuard");
  const pb = await import("../lib/personBudget");
  const { GET: join } = await import("../app/join/route");
  guard.clearAccessGuard();
  const open = (code: string | null, ip = "192.168.1.80", cookie = "") =>
    join(new Request(`http://192.168.1.20:3100/join${code === null ? "" : `?code=${encodeURIComponent(code)}`}`, { headers: { host: "192.168.1.20:3100", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) } }));

  // ---- 一般の合言葉 ----
  const g = await open(CODE);
  const gCookies = g.headers.getSetCookie();
  check("一般の合言葉のリンク：印を渡して / に移す（303）", g.status === 303 && g.headers.get("location") === "/", hide(`${g.status} ${g.headers.get("location")}`));
  check("一般：合言葉の印・人の印を渡し、メンターの印は外す", gCookies.some((c) => c.startsWith(`${share.ACCESS_COOKIE}=${share.accessToken()}`)) && gCookies.some((c) => c.startsWith(`${pb.PERSON_COOKIE}=`)) && gCookies.some((c) => c.startsWith(`${share.MENTOR_COOKIE}=;`) && /Max-Age=0/.test(c)));
  check("印は httpOnly で、合言葉の値そのものは入れない", gCookies.every((c) => /HttpOnly/.test(c)) && !gCookies.join(";").includes(CODE));
  check("移ったあとのアドレスに合言葉を残さない", !(g.headers.get("location") ?? "").includes("code"));
  check("Referrer-Policy: no-referrer と no-store", g.headers.get("referrer-policy") === "no-referrer" && g.headers.get("cache-control") === "no-store");

  // ---- メンターの合言葉 ----
  const m = await open(MENTOR, "192.168.1.81");
  const mCookies = m.headers.getSetCookie();
  check("メンターの合言葉のリンク：メンターの印も渡して / に移す", m.status === 303 && m.headers.get("location") === "/" && mCookies.some((c) => c.startsWith(`${share.MENTOR_COOKIE}=${share.mentorToken()}`)));
  check("もう人の印があれば変えない", !(await open(CODE, "192.168.1.82", `${pb.PERSON_COOKIE}=already`)).headers.getSetCookie().some((c) => c.startsWith(`${pb.PERSON_COOKIE}=`)));
  // 印は、別のサイト（QR・Notion）から開いて移った先の画面でも送られる形（SameSite=Lax）
  check("リンクで渡す印は SameSite=Lax（Notion や QR から開いても、移った先で使える）", [...gCookies, ...mCookies].filter((c) => !/Max-Age=0/.test(c)).every((c) => /SameSite=Lax/.test(c)));

  // ---- 違う・ない・続けて間違える ----
  const ng = await open("wrong-code-value");
  check("違う合言葉：合言葉の画面に、理由の印だけ付けて移す（印は渡さない）", ng.status === 303 && ng.headers.get("location") === "/access?join=ng" && ng.headers.getSetCookie().length === 0);
  check("合言葉がないリンクも同じ", (await open(null, "192.168.1.83")).headers.get("location") === "/access?join=ng");
  guard.clearAccessGuard();
  const locs: string[] = [];
  for (let i = 0; i < 5; i++) locs.push((await open("wrong-code-value", "192.168.1.84")).headers.get("location") ?? "");
  check("同じ送り元が5回間違えたら、しばらく受け付けない（合言葉の画面と同じ回数）", locs.slice(0, 4).every((l) => l === "/access?join=ng") && locs[4] === "/access?join=locked", locs.join(","));
  const lockedRight = await open(CODE, "192.168.1.84");
  check("止められている間は、正しいリンクでも入れない", lockedRight.headers.get("location") === "/access?join=locked" && lockedRight.headers.getSetCookie().length === 0);
  guard.clearAccessGuard();
  for (let i = 0; i < 31; i++) await open("wrong-code-value", `10.20.${Math.floor(i / 4)}.${i % 4}`);
  check("全体の上限：送り元を変えて31回間違えたら、ほかの人のリンクも1分止める", (await open(CODE, "192.168.1.90")).headers.get("location") === "/access?join=locked");
  guard.clearAccessGuard();
  check("リンクの間違いと合言葉の画面の間違いは、同じ回数に数える（同じ lib/accessGuard.ts）", read("app/join/route.ts").includes("noteAccessFailure(key)") && read("app/join/route.ts").includes("accessLock(key)"));

  // ---- 入口・記録に残さない ----
  const gate = share.checkRequest({ method: "GET", pathname: "/join", host: "192.168.1.20:3100", origin: null, forwardedFor: null, cookie: null, headerCode: null });
  check("入口：/join は合言葉の印なしで開ける（確かめるのは /join）", gate.ok);
  check("入口：/join 以外の画面は、今までどおり合言葉の画面へ", !share.checkRequest({ method: "GET", pathname: "/", host: "192.168.1.20:3100", origin: null, forwardedFor: null, cookie: null, headerCode: null }).ok);
  const src = read("app/join/route.ts");
  check("/join はアドレス・合言葉をログに出さない", !/console\.(log|error|warn|info)/.test(src));
  const accessPage = read("app/access/page.tsx");
  check("合言葉の画面：リンクで入れなかった理由を出す", accessPage.includes("リンクの合言葉が違うか、古くなっています") && accessPage.includes("合言葉の間違いが続いたので"));

  // ---- 発表用だけ：/share-links ----
  const page = read("app/share-links/page.tsx");
  check("/share-links は見せる用では開けない（404）", page.includes('if (shareMode() === "lan") notFound();'));
  delete process.env.SHARE_MODE;
  const present = share.checkRequest({ method: "GET", pathname: "/share-links", host: "192.168.1.20:3000", origin: null, forwardedFor: null, cookie: null, headerCode: null });
  check("/share-links は発表用でも、この端末（localhost）からだけ", !present.ok && share.checkRequest({ method: "GET", pathname: "/share-links", host: "127.0.0.1:3000", origin: null, forwardedFor: null, cookie: null, headerCode: null }).ok);
  const { default: ShareLinksPage } = await import("../app/share-links/page");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const html = renderToStaticMarkup(await ShareLinksPage({ searchParams: Promise.resolve({}) }));
  const hasIp = !html.includes("会場の Wi-Fi の IP が見つかりません");
  check("一般用は「Notion に貼る用」、メンター・審査員用は「運営さんに渡す用（Notion やスライドに出さない）」", html.includes("Notion に貼る用") && html.includes("運営さんに渡す用（Notion やスライドに出さない）") && html.includes("メンター・審査員用のリンク"));
  if (hasIp) {
    check("見せる用のアドレス（この PC の IP と 3100番）と、/join?code=… のリンクを2つ（コピーのボタンつき）", /見せる用のアドレス：.*http:\/\/\d+\.\d+\.\d+\.\d+:3100/.test(html) && (html.match(/http:\/\/\d+\.\d+\.\d+\.\d+:3100\/join\?code=/g) ?? []).length === 2 && (html.match(/リンクをコピー/g) ?? []).length === 2);
    check("リンクには、それぞれの合言葉が入る（この画面だけ）", html.includes(encodeURIComponent(CODE)) && html.includes(encodeURIComponent(MENTOR)));
  } else check("Wi-Fi の IP がないときは、つなぐように出す", html.includes("Wi-Fi につないでから"));
  process.env.MENTOR_ACCESS_CODE = "";
  const html2 = renderToStaticMarkup(await ShareLinksPage({ searchParams: Promise.resolve({}) }));
  check("メンター用の合言葉がなければ、メンター・審査員用は「作れません」と出す", !hasIp || ((html2.match(/\/join\?code=/g) ?? []).length === 1 && html2.includes("MENTOR_ACCESS_CODE）が設定されていない")));
  process.env.MENTOR_ACCESS_CODE = MENTOR;
  check("/share-links は referrer を送らない・検索に出さない", page.includes('referrer: "no-referrer"') && page.includes("index: false"));
  const { lanRank } = await import("../lib/shareLinks");
  const ranked = [
    { name: "Tailscale", ip: "100.82.52.98" },
    { name: "vEthernet (Default Switch)", ip: "172.29.80.1" },
    { name: "Wi-Fi", ip: "192.168.17.81" },
    { name: "イーサネット", ip: "10.0.0.5" },
  ].sort((a, b) => lanRank(a) - lanRank(b));
  check("アドレスは会場の Wi-Fi を先に選ぶ（Tailscale・仮想の口はあと）", ranked.map((a) => a.name).join(",") === "Wi-Fi,イーサネット,Tailscale,vEthernet (Default Switch)", ranked.map((a) => a.name).join(","));
  check("QR と使い捨ての招待リンクは作らない", !read("package.json").includes("qrcode") && !fs.existsSync(path.join(process.cwd(), "app", "share-qr")) && !fs.existsSync(path.join(process.cwd(), "lib", "mentorInvite.ts")) && !read("app/join/route.ts").includes("invite"));

  // ---- 文書 ----
  const doc = read("docs/demo_checklist.md");
  check("docs/demo_checklist.md に /share-links と /join の使い方（2つのリンクの渡し方）", doc.includes("/share-links") && doc.includes("/join") && doc.includes("Notion に貼る用") && doc.includes("運営さんに渡す用"));
  check("文書に合言葉の値を書かない（例の値はリンクに入れない）", !/\/join\?code=[A-Za-z0-9]/.test(doc));

  ["SHARE_MODE", "ACCESS_CODE", "MENTOR_ACCESS_CODE", "SHARE_BUDGET_USD", "SHARE_PER_PERSON_USD"].forEach((k) => delete process.env[k]);
  console.log(failed ? `\n${failed}件 失敗` : "\nすべて合格");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(hide(String(e?.stack ?? e)));
  process.exit(1);
});
