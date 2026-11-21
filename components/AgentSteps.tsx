"use client";

import { useEffect, useRef } from "react";
import type { Proposal } from "@/app/_client/types";
import { TOOL_LABEL } from "./labels";
import { Spinner } from "./ui";
import { progressOf, progressText, stageOfEvents } from "@/lib/progressStage";

export type LogItem =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; summary?: string; ok?: boolean }
  | { kind: "note"; text: string; tone: "info" | "warn" | "error" | "ok" };

function inputPreview(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "search_cards" || name === "search_activities") return `「${i.query ?? ""}」`;
  if (name === "get_card") return String(i.card_id ?? "");
  if (name === "check_schedule") return `${i.id ?? ""} ${i.date ?? ""}`;
  if (name === "get_published") return String(i.author_id ?? "");
  if (name === "submit_candidates") return "";
  if ("id" in i) return String(i.id);
  return "";
}

function oneLine(log: LogItem[], result: Proposal | null, seconds: number) {
  const tools = log.filter((l): l is Extract<LogItem, { kind: "tool" }> => l.kind === "tool");
  const cards = new Set(tools.filter((t) => t.name === "get_card").map((t) => String((t.input as { card_id?: string })?.card_id))).size;
  const looked = cards > 0 ? `${cards}枚のカードを調べて` : `${tools.length}回調べて`;
  // 受信箱で準備済みの依頼を開いたときは、その場で動かしていないので秒数を出さない
  const took = seconds > 0 ? `（${seconds}秒）` : "";
  if (!result) return `${looked}、途中で止まりました${took}`;
  const n = result.candidates.length;
  return n > 0 ? `${looked}、${n}人を選びました${took}` : `${looked}、合う人はいませんでした${took}`;
}

/** While running: the steps grow one by one. When done: one summary line; open it to see the steps. */
export function AgentSteps({ log, running, seconds, result }: { log: LogItem[]; running: boolean; seconds: number; result: Proposal | null }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (running) end.current?.scrollIntoView({ block: "nearest" });
  }, [log.length, running]);
  const problems = log.filter((l) => l.kind === "note" && (l.tone === "error" || l.tone === "warn"));

  let n = 0;
  const list = (
    <ol className="steps" aria-live="polite">
      {log.map((item, i) => {
        if (item.kind === "thinking") return <li key={i} className="step-why">{item.text}</li>;
        if (item.kind === "note")
          return (
            <li key={i} className={`log-line log-${item.tone}`}>
              {item.text}
            </li>
          );
        n += 1;
        return (
          <li key={i} className="step">
            <span className={`step-num${item.ok === false ? " is-bad" : ""}`} aria-hidden="true">
              {n}.
            </span>
            <span>
              {TOOL_LABEL[item.name] ?? item.name}
              <span className="meta">
                {"　"}
                {inputPreview(item.name, item.input)}
                {item.summary === undefined ? " …" : ` → ${item.summary}`}
              </span>
            </span>
          </li>
        );
      })}
      {result?.learnings_applied.map((t, i) => (
        <li key={`l${i}`} className="step-why">
          打診履歴から：{t}
        </li>
      ))}
      <li ref={end} className="sr-anchor" aria-hidden="true" />
    </ol>
  );

  if (running) {
    // 動いている間は、考えた内容や内部の名前は出さず、今の段階を1行だけ出す（作業ログの流れから決める）
    const stage = stageOfEvents(log.flatMap((l) => (l.kind === "tool" ? [{ type: "tool_call", name: l.name }] : [])));
    return (
      <div className="steps-wrap" aria-live="polite">
        <Spinner label={`${progressText(progressOf(stage))}・${seconds}秒`} />
      </div>
    );
  }

  return (
    <div className="steps-wrap">
      {problems.map((p, i) => p.kind === "note" && <p key={i} className={`log-line log-${p.tone}`}>{p.text}</p>)}
      <details className="steps-details">
        <summary>{oneLine(log, result, seconds)}</summary>
        {list}
      </details>
    </div>
  );
}
