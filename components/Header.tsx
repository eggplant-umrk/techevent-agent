"use client";

import type { ModelChoice } from "@/app/_client/types";
import { usd } from "./labels";
import { Tag } from "./ui";

export type View = "notebook" | "history" | "learnings";
const VIEWS: Array<[View, string]> = [
  ["notebook", "ネタ帳"],
  ["history", "依頼の履歴"],
  ["learnings", "Agentの学び"],
];

export function Header({
  view,
  onView,
  runUsd,
  totalUsd,
  models,
  pending,
  updating,
  onUpdate,
  mock,
}: {
  view: View;
  onView: (v: View) => void;
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
        {mock && <Tag tone="warn">モックデータで表示中</Tag>}
      </div>
      <nav aria-label="画面の切り替え" className="nav">
        {VIEWS.map(([v, label]) => (
          <button key={v} type="button" className="nav-item" aria-current={view === v ? "page" : undefined} onClick={() => onView(v)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="header-right">
        <p className="cost" title={models ? `ループ：${models.loop}／重い仕事：${models.heavy}` : undefined}>
          今回 <strong>{usd(runUsd)}</strong>・累計 <strong>{usd(totalUsd)}</strong> / $200
        </p>
        <button type="button" className="btn" onClick={onUpdate} disabled={updating}>
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
