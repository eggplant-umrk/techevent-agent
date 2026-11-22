// /share-links：見せる用（3100番）に合言葉を打たずに入るリンク（発表用の画面だけ。この端末〔127.0.0.1〕からだけ開ける。見せる用では 404）。
//   - 一般用のリンク（/join?code=一般の合言葉）：Notion に貼る用
//   - メンター・審査員用のリンク（/join?code=メンターの合言葉）：運営さんに渡す用（Notion やスライドに出さない）
//   - 見せる用のアドレス（この PC の会場の Wi-Fi の IP と見せる用のポート SHARE_PORT、既定 3100）も出す。IP が複数あれば選べる
//   - 合言葉の値を出すのはこの画面のリンクだけ（ログ・文書・テストには出さない）
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { accessCode, mentorCode, shareMode } from "@/lib/share";
import { chooseIp, joinUrl, lanAddresses, shareBaseUrl } from "@/lib/shareLinks";
import { CopyButton } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "見せる用のリンク｜ネタ帳Agent", referrer: "no-referrer", robots: { index: false, follow: false } };

function LinkCard({ title, use, note, url, missing }: { title: string; use: string; note: string; url: string | null; missing: string }) {
  return (
    <section className="surface pad-lg" style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <h2 className="h3" style={{ margin: 0 }}>
        {title}
      </h2>
      <p className="strong" style={{ margin: 0 }}>
        {use}
      </p>
      <p className="meta" style={{ margin: 0 }}>
        {note}
      </p>
      {url ? (
        <>
          <code style={{ fontSize: 12, wordBreak: "break-all" }}>{url}</code>
          <CopyButton text={url} label="リンクをコピー" primary />
        </>
      ) : (
        <p className="meta warn-text">{missing}</p>
      )}
    </section>
  );
}

export default async function ShareLinksPage({ searchParams }: { searchParams: Promise<{ ip?: string }> }) {
  if (shareMode() === "lan") notFound(); // 見せる用では開けない
  const addrs = lanAddresses();
  const chosen = chooseIp((await searchParams).ip);
  const general = accessCode();
  const mentor = mentorCode();
  return (
    <main style={{ maxWidth: 960, margin: "32px auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px" }}>見せる用に入るリンク</h1>
        <p className="meta" style={{ margin: 0 }}>
          開くと、合言葉を打たずに見せる用に入れます。この画面は発表用の端末でだけ開けます。合言葉が見えるので、スクリーンに映さないでください。
        </p>
      </div>
      {!chosen ? (
        <p className="banner banner-error">会場の Wi-Fi の IP が見つかりません。Wi-Fi につないでから、読み込み直してください。</p>
      ) : (
        <>
          <p className="meta" style={{ margin: 0 }}>
            見せる用のアドレス：<span className="strong">{shareBaseUrl(chosen.ip)}</span>（{chosen.name}）
            {addrs.length > 1 && (
              <>
                {"　ほかの IP："}
                {addrs
                  .filter((a) => a.ip !== chosen.ip)
                  .map((a) => (
                    <Link key={a.ip} className="link" href={`/share-links?ip=${encodeURIComponent(a.ip)}`} style={{ marginRight: 8 }}>
                      {a.ip}（{a.name}）
                    </Link>
                  ))}
              </>
            )}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
            <LinkCard
              title="一般用のリンク"
              use="Notion に貼る用"
              note="一般の合言葉入りのリンクです。参加者みんなに配ります（1人あたりの上限は SHARE_PER_PERSON_USD）。"
              url={general ? joinUrl(chosen.ip, general) : null}
              missing="一般の合言葉（ACCESS_CODE）が設定されていないので、リンクを作れません（.env を確かめてください）。"
            />
            <LinkCard
              title="メンター・審査員用のリンク"
              use="運営さんに渡す用（Notion やスライドに出さない）"
              note="メンター用の合言葉入りのリンクです。開いた人はメンターとして入ります（1人あたりの上限は SHARE_MENTOR_USD）。"
              url={mentor ? joinUrl(chosen.ip, mentor) : null}
              missing="メンター用の合言葉（MENTOR_ACCESS_CODE）が設定されていないので、リンクを作れません（.env を確かめてください）。"
            />
          </div>
        </>
      )}
    </main>
  );
}
