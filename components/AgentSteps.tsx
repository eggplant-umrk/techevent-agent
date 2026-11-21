"use client";

import { useEffect, useRef } from "react";
import { TOOL_LABEL } from "./labels";
import { Spinner } from "./ui";

export type LogItem =
  | { kind: "thinking"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; summary?: string; ok?: boolean }
  | { kind: "note"; text: string; tone: "info" | "warn" | "error" | "ok" };

function inputPreview(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "search_cards" || name === "search_activities") {
    const f = i.filter && typeof i.filter === "object" ? Object.keys(i.filter as object).join("・") : "";
    return `「${i.query ?? ""}」${f ? `（${f}）` : ""}`;
  }
  if (name === "get_card") return String(i.card_id ?? "");
  if (name === "check_schedule") return `${i.id ?? ""} ${i.date ?? ""}`;
  if (name === "get_published") return String(i.author_id ?? "");
  if (name === "submit_candidates") return "";
  if ("id" in i) return String(i.id);
  return "";
}

/** "Agentがやったこと": numbered steps (one per tool call), with the reasoning shown in between. Grows while running. */
export function AgentSteps({ log, running, seconds }: { log: LogItem[]; running: boolean; seconds: number }) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (running) end.current?.scrollIntoView({ block: "nearest" });
  }, [log.length, running]);
  const toolCount = log.filter((l) => l.kind === "tool").length;
  let n = 0;

  return (
    <section className="surface pad-lg" aria-labelledby="steps-title">
      <div className="row-between">
        <h3 id="steps-title" className="h3">
          Agentがやったこと
        </h3>
        <span className="meta">
          {toolCount}ステップ・{seconds}秒
        </span>
      </div>
      <ol className="steps" aria-live="polite">
        {log.map((item, i) => {
          if (item.kind === "thinking")
            return (
              <li key={i} className="step-why">
                <span className="meta">判断</span> {item.text}
              </li>
            );
          if (item.kind === "note")
            return (
              <li key={i} className={`log-line log-${item.tone}`}>
                {item.text}
              </li>
            );
          n += 1;
          const pending = item.summary === undefined;
          return (
            <li key={i} className="step">
              <span className={`step-num${item.ok === false ? " is-bad" : ""}`} aria-hidden="true">
                {n}
              </span>
              <span>
                <span className="strong">{TOOL_LABEL[item.name] ?? item.name}</span>
                <span className="meta">
                  {"　"}
                  {inputPreview(item.name, item.input)}
                  {pending ? " …" : ` → ${item.summary}`}
                </span>
              </span>
            </li>
          );
        })}
        <li ref={end} className="sr-anchor" aria-hidden="true" />
      </ol>
      {running && <Spinner label={`考えています…（${seconds}秒）`} />}
    </section>
  );
}
