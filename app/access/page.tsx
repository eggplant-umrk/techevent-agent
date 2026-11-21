"use client";
// 合言葉の入力（SHARE_MODE=lan で、別の端末から開いたとき）。合っていれば、もとの画面に戻る
import { useState } from "react";
import { safeNext } from "@/lib/safeNext";

export default function AccessPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      const j = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "確かめられませんでした。もう一度入れてください");
      return;
    }
    window.location.href = safeNext(new URLSearchParams(window.location.search).get("next"));
  }

  return (
    <main style={{ maxWidth: 420, margin: "80px auto", padding: "0 16px" }}>
      <form className="surface pad-lg" onSubmit={submit} aria-labelledby="access-title">
        <h1 id="access-title" style={{ fontSize: 18, fontWeight: 700 }}>
          ネタ帳Agent
        </h1>
        <p className="meta">見せている人から聞いた合言葉を入れてください。</p>
        <label className="meta" htmlFor="access-code">
          合言葉
        </label>
        <input
          id="access-code"
          type="password"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          style={{ height: 40, padding: "0 12px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 15 }}
        />
        {error && (
          <p role="alert" style={{ color: "var(--danger, #b42318)", fontSize: 13 }}>
            {error}
          </p>
        )}
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>
            {busy ? "確かめています…" : "入る"}
          </button>
        </div>
      </form>
    </main>
  );
}
