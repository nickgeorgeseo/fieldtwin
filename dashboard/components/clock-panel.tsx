"use client";

import { useState } from "react";
import { twinSend } from "@/lib/twin-api.ts";
import { formatTwinTime, minutesLabel } from "@/lib/twin-time.ts";
import { useTwin } from "./twin-provider.tsx";
import { Button, Card, NoticeLine, TextInput, VendorBadge } from "./ui.tsx";
import { useAction } from "./use-action.ts";

const JUMPS = [15, 60, 360, 1440];

/** Move twin time forward: tokens expire, rate limits refill, and scheduled scenario events happen on the way. */
export function ClockPanel() {
  const { status } = useTwin();
  const { busy, notice, run } = useAction();
  const [custom, setCustom] = useState("90");
  const offset = status?.company.utcOffsetHours ?? 0;

  const advance = (minutes: number) =>
    run(async () => {
      const result = await twinSend<{ twinTime: string; scenarioEvents: number }>("POST", "/clock/advance", { minutes });
      const time = formatTwinTime(result.twinTime, offset);
      const happened = result.scenarioEvents === 1 ? "1 scheduled event" : `${result.scenarioEvents} scheduled events`;
      return `Moved ${minutesLabel(minutes)} ahead, to ${time.time} on ${time.day}. ${happened} happened on the way.`;
    });

  return (
    <Card title="Clock">
      <div className="grid grid-cols-2 gap-2">
        {JUMPS.map((minutes) => (
          <Button key={minutes} disabled={busy || !status} onClick={() => advance(minutes)}>
            +{minutesLabel(minutes)}
          </Button>
        ))}
      </div>
      <form
        className="mt-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void advance(Number(custom));
        }}
      >
        <label className="text-sm text-zinc-500" htmlFor="advance-minutes">
          Minutes
        </label>
        <TextInput
          id="advance-minutes"
          type="number"
          min={0}
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          className="w-24"
        />
        <Button type="submit" tone="primary" disabled={busy || !status}>
          Advance
        </Button>
      </form>
      <NoticeLine notice={notice} />
      <h3 className="mt-5 text-xs font-medium text-zinc-500 dark:text-zinc-400">Scheduled by the scenario</h3>
      {status?.upcoming.length ? (
        <ul className="mt-2 space-y-1.5 text-sm">
          {status.upcoming.map(({ at, vendor, action, params }) => (
            <li key={`${at}-${vendor}-${action}`} className="flex items-center gap-2">
              <span className="w-20 font-mono tabular-nums text-zinc-500">{formatTwinTime(at, offset).time}</span>
              <VendorBadge vendor={vendor} />
              <span>
                {action} <span className="font-mono">{JSON.stringify(params)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">
          {status?.scenario
            ? "Nothing more: everything the scenario scheduled has happened."
            : "Nothing. Load a scenario with a timeline, like heat-wave-monday."}
        </p>
      )}
    </Card>
  );
}
