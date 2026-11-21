"use client";

import type { ModelChoice } from "@/app/_client/types";
import { usd } from "./labels";

/** 画面のタブ（いつ使うか で分ける）。ヘッダーのタブはこの3つだけ */
export type Tab = "inbox" | "notebook" | "archive";
export const TABS: Array<{ id: Tab; label: string }> = [
  { id: "inbox", label: "受信箱" },
  { id: "notebook", label: "ネタ帳" },
  { id: "archive", label: "アーカイブ" },
];

export function Header({
  tab,
  onTab,
  debug,
  runUsd,
  totalUsd,
  models,
  mock,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  /** ?debug in the URL: show cost and models (not for everyday use). */
  debug: boolean;
  runUsd: number;
  totalUsd: number;
  models: ModelChoice | null;
  mock: boolean;
}) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5V5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-1.5Z" />
            <path d="M8 7h6" />
            <path d="M8 11h6" />
          </svg>
        </span>
        <span className="brand-name">ネタ帳Agent</span>
        {mock && <span className="meta">（モック）</span>}
      </div>
      <nav className="tabs" aria-label="画面の切り替え">
        {TABS.map((t) => (
          <button key={t.id} type="button" className="tab" aria-current={tab === t.id ? "page" : undefined} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="header-right">
        {debug && (
          <span className="meta debug-cost">
            今回 {usd(runUsd)}・累計 {usd(totalUsd)}
            {models && `・${models.loop} / ${models.heavy}${models.switched ? "（切替中）" : ""}`}
          </span>
        )}
      </div>
    </header>
  );
}
