"use client";

import { useEffect, useState } from "react";
import { twinGet, twinSend } from "@/lib/twin-api.ts";
import type { ScenarioInfo, TwinStatus } from "@/lib/twin-types.ts";
import { useTwin } from "./twin-provider.tsx";
import { Badge, Button, Card, NoticeLine } from "./ui.tsx";
import { useAction } from "./use-action.ts";

const EXAMPLE = `name: My scenario
seed: 7
startTime: "2026-07-13T11:00:00Z"
faults:
  - name: qbo-throttled-writes
    vendor: quickbooks
    method: POST
    rate: 0.2
    effect: { status: 429, message: "ThrottleExceeded" }
timeline:
  - at: "+2h"
    jobber: { payInvoices: 3 }
`;

/** The ready-made scenarios, your own YAML, and the way back to the start. */
export function ScenarioPanel() {
  const { status } = useTwin();
  const { busy, notice, run } = useAction();
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [yaml, setYaml] = useState(EXAMPLE);
  const reachable = status !== null;

  useEffect(() => {
    if (reachable) twinGet<ScenarioInfo[]>("/scenarios").then(setScenarios, () => setScenarios([]));
  }, [reachable]);

  const loaded = (twin: TwinStatus) => `Loaded "${twin.scenario}": seed ${twin.seed}, ${twin.eventCount} events, auth ${twin.authMode}.`;
  const reset = () => {
    const what = status?.scenario ? `the start of "${status.scenario}"` : "the default world";
    if (!window.confirm(`Reset the twin to ${what}? Everything since is undone, checkpoints included.`)) return;
    void run(async () => {
      await twinSend<TwinStatus>("POST", "/reset");
      return `Back to ${what}.`;
    });
  };

  return (
    <Card
      title="Scenario"
      actions={
        <Button tone="danger" disabled={busy || !status} onClick={reset}>
          Reset
        </Button>
      }
    >
      <ul className="space-y-3">
        {scenarios.map(({ name, title, description }) => (
          <li key={name} className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                {title} {status?.scenario === title && <Badge tone="violet">loaded</Badge>}
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
            </div>
            <Button
              disabled={busy}
              onClick={() => run(async () => loaded(await twinSend<TwinStatus>("POST", `/scenarios/${encodeURIComponent(name)}`)))}
            >
              Load
            </Button>
          </li>
        ))}
      </ul>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-zinc-600 dark:text-zinc-300">Load your own YAML</summary>
        <textarea
          aria-label="Scenario YAML"
          value={yaml}
          onChange={(event) => setYaml(event.target.value)}
          spellCheck={false}
          rows={12}
          className="mt-2 w-full rounded-md border border-zinc-300 bg-zinc-50 p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
        />
        <Button
          tone="primary"
          disabled={busy}
          onClick={() => run(async () => loaded(await twinSend<TwinStatus>("POST", "/scenario", yaml, "text/yaml")))}
        >
          Load YAML
        </Button>
      </details>
      <NoticeLine notice={notice} />
    </Card>
  );
}
