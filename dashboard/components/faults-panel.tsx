"use client";

import { useState } from "react";
import { FAULT_PRESETS, withRule } from "@/lib/fault-rules.ts";
import { twinSend } from "@/lib/twin-api.ts";
import { useTwin } from "./twin-provider.tsx";
import { Badge, Button, Card, NoticeLine } from "./ui.tsx";
import { useAction } from "./use-action.ts";

/** Make the vendor APIs misbehave on purpose, in their own error formats (PUT /_twin/faults). */
export function FaultsPanel() {
  const { status } = useTwin();
  const { busy, notice, run } = useAction();
  const [text, setText] = useState("[]");
  const active = status?.activeFaults ?? [];

  const apply = (rules: unknown) =>
    run(async () => {
      const result = await twinSend<{ activeFaults: string[] }>("PUT", "/faults", rules);
      return result.activeFaults.length ? `Active now: ${result.activeFaults.join(", ")}.` : "No faults: the APIs behave.";
    });
  const applyWritten = () => {
    let rules: unknown;
    try {
      rules = JSON.parse(text);
    } catch (problem) {
      return run(async () => {
        throw new Error(`The rules aren't valid JSON: ${problem instanceof Error ? problem.message : problem}`);
      });
    }
    return apply(rules);
  };

  return (
    <Card title="Faults">
      <div className="flex flex-wrap gap-1.5">
        {active.length ? (
          active.map((name) => (
            <Badge key={name} tone="red">
              {name}
            </Badge>
          ))
        ) : (
          <span className="text-sm text-zinc-500">None: the APIs behave.</span>
        )}
      </div>
      <h3 className="mt-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">Add to the rules below</h3>
      <ul className="mt-1.5 space-y-1">
        {FAULT_PRESETS.map(({ label, rule }) => (
          <li key={rule.name}>
            <button
              type="button"
              onClick={() => setText(withRule(text, rule))}
              className="text-left text-sm text-violet-700 hover:underline dark:text-violet-300"
            >
              + {label}
            </button>
          </li>
        ))}
      </ul>
      <textarea
        aria-label="Fault rules (JSON)"
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={8}
        className="mt-3 w-full rounded-md border border-zinc-300 bg-zinc-50 p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
      />
      <p className="text-xs text-zinc-500">The twin names active rules but doesn't show them, so applying replaces them all.</p>
      <div className="mt-3 flex gap-2">
        <Button tone="primary" disabled={busy || !status} onClick={applyWritten}>
          Apply
        </Button>
        <Button
          tone="danger"
          disabled={busy || !status || active.length === 0}
          onClick={() => {
            setText("[]");
            void apply([]);
          }}
        >
          Clear all
        </Button>
      </div>
      <NoticeLine notice={notice} />
    </Card>
  );
}
