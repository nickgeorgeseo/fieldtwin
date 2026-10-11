"use client";

import { useEffect, useState } from "react";
import { twinGet, twinSend } from "@/lib/twin-api.ts";
import { formatTwinTime } from "@/lib/twin-time.ts";
import type { Change, TwinStatus } from "@/lib/twin-types.ts";
import { ChangeList } from "./change-list.tsx";
import { useTwin } from "./twin-provider.tsx";
import { Button, Card, NoticeLine, TextInput } from "./ui.tsx";
import { useAction } from "./use-action.ts";

const SOURCES = [
  { source: "", label: "Everything" },
  { source: "api", label: "Your code" },
  { source: "scenario", label: "Scenario" },
  { source: "control", label: "Control" },
];

/** Name a moment, see exactly what changed since (judge an agent on this, not on what it says it did), undo it. */
export function CheckpointsPanel() {
  const { status, logKey } = useTwin();
  const { busy, notice, run } = useAction();
  const [name, setName] = useState("before-agent");
  const [chosen, setChosen] = useState<string | null>(null);
  const [source, setSource] = useState("");
  const [changes, setChanges] = useState<Change[]>([]);
  const checkpoints = status?.checkpoints ?? [];
  const selected = checkpoints.find((checkpoint) => checkpoint.name === chosen) ?? checkpoints.at(-1);
  const path = selected && `/checkpoints/${encodeURIComponent(selected.name)}`;
  const offset = status?.company.utcOffsetHours ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: logKey changes when the log may have, which is when to read again
  useEffect(() => {
    if (!path) return setChanges([]);
    let current = true;
    twinGet<Change[]>(`${path}/changes${source ? `?source=${source}` : ""}`).then(
      (read) => current && setChanges(read),
      () => current && setChanges([]),
    );
    return () => {
      current = false;
    };
  }, [path, source, logKey]);

  const mark = () =>
    run(async () => {
      const checkpoint = await twinSend<{ name: string; seq: number }>("POST", `/checkpoints/${encodeURIComponent(name.trim())}`);
      setChosen(checkpoint.name);
      return `Marked "${checkpoint.name}", after event ${checkpoint.seq}.`;
    });
  const rewind = () => {
    if (!selected || !path) return;
    if (!window.confirm(`Rewind to "${selected.name}"? Everything after it is undone, later checkpoints included.`)) return;
    void run(async () => {
      const twin = await twinSend<TwinStatus>("POST", `${path}/rewind`);
      return `Rewound to "${selected.name}": ${twin.eventCount} events. The same requests will meet the same faults again.`;
    });
  };

  return (
    <Card title="Checkpoints" className="lg:col-span-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void mark();
        }}
      >
        <TextInput aria-label="Checkpoint name" value={name} onChange={(event) => setName(event.target.value)} className="w-56 font-mono" />
        <Button type="submit" tone="primary" disabled={busy || !status || !name.trim()}>
          Mark this moment
        </Button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {checkpoints.map((checkpoint) => (
            <button
              key={checkpoint.name}
              type="button"
              aria-pressed={checkpoint.name === selected?.name}
              onClick={() => setChosen(checkpoint.name)}
              className={`rounded-full border px-2.5 py-1 font-mono text-xs ${
                checkpoint.name === selected?.name
                  ? "border-violet-500 bg-violet-50 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {checkpoint.name} · {formatTwinTime(checkpoint.time, offset).time}
            </button>
          ))}
        </div>
      </form>
      <NoticeLine notice={notice} />
      {selected && path ? (
        <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm">
              <span className="font-semibold">{changes.length}</span> change{changes.length === 1 ? "" : "s"} since{" "}
              <span className="font-mono">{selected.name}</span>
            </p>
            <div className="flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
              {SOURCES.map((option) => (
                <button
                  key={option.source}
                  type="button"
                  aria-pressed={source === option.source}
                  onClick={() => setSource(option.source)}
                  className={`rounded px-2 py-1 text-xs ${source === option.source ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "text-zinc-600 dark:text-zinc-300"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <a
              href={`/api/twin/log.jsonl?since=${encodeURIComponent(selected.name)}`}
              download={`${selected.name}.jsonl`}
              className="text-xs text-violet-700 underline dark:text-violet-300"
            >
              Log since
            </a>
            <Button tone="danger" disabled={busy} onClick={rewind}>
              Rewind
            </Button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <ChangeList
              summaries={changes.map((change) => change.summary)}
              utcOffsetHours={offset}
              empty="Nothing yet. Point your code or agent at the twin and watch this list."
            />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">No checkpoints yet. Mark one before you let your code or agent loose.</p>
      )}
    </Card>
  );
}
