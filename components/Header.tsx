"use client";

import type { ModelChoice } from "@/app/_client/types";
import { usd } from "./labels";

export function Header({
  debug,
  runUsd,
  totalUsd,
  models,
  pending,
  updating,
  onUpdate,
  mock,
}: {
  /** ?debug in the URL: show cost and models (not for everyday use). */
  debug: boolean;
  runUsd: number;
  totalUsd: number;
  models: ModelChoice | null;
  pending: number;
  updating: boolean;
  onUpdate: () => void;
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
      <div className="header-right">
        {debug && (
          <span className="meta debug-cost">
            今回 {usd(runUsd)}・累計 {usd(totalUsd)}
            {models && `・${models.loop} / ${models.heavy}${models.switched ? "（切替中）" : ""}`}
          </span>
        )}
        <button type="button" className="btn btn-sm" onClick={onUpdate} disabled={updating}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
          {updating ? "更新しています…" : `ネタ帳を更新${pending ? `（${pending}人分）` : ""}`}
        </button>
      </div>
    </header>
  );
}
