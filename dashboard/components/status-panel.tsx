"use client";

import { formatTwinTime } from "@/lib/twin-time.ts";
import { useTwin } from "./twin-provider.tsx";
import { Badge, Card, Stat } from "./ui.tsx";

/** Who the twin is pretending to be, what time it is there, and how it is set up right now. */
export function StatusPanel() {
  const { status } = useTwin();
  if (!status) {
    return (
      <Card title="Twin" className="lg:col-span-2">
        <p className="text-sm text-zinc-500">Waiting for the twin…</p>
      </Card>
    );
  }
  const { company } = status;
  const time = formatTwinTime(status.twinTime, company.utcOffsetHours);
  const next = status.upcoming[0];
  return (
    <Card title="Twin" className="lg:col-span-2">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xl font-semibold">{company.name}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {tradeName(company.trade)} · {company.city}, {company.state}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-3xl font-semibold tabular-nums">{time.time}</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {time.day} · {time.zone}
          </p>
        </div>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-4 sm:grid-cols-4 dark:border-zinc-800">
        <Stat label="Scenario">{status.scenario ?? "Default world"}</Stat>
        <Stat label="Seed">
          <span className="font-mono">{status.seed}</span>
        </Stat>
        <Stat label="Events in the log">{status.eventCount.toLocaleString("en-US")}</Stat>
        <Stat label="Auth">
          <Badge tone={status.authMode === "oauth" ? "violet" : "amber"}>{status.authMode}</Badge>
        </Stat>
        <Stat label="Faults">{status.activeFaults.length ? `${status.activeFaults.length} active` : "None"}</Stat>
        <Stat label="Webhook subscriptions">{status.webhookSubscriptions}</Stat>
        <Stat label="Checkpoints">{status.checkpoints.length}</Stat>
        <Stat label="Next scheduled">
          {next ? `${formatTwinTime(next.at, company.utcOffsetHours).time}: ${next.action} ${JSON.stringify(next.params)}` : "Nothing"}
        </Stat>
      </dl>
    </Card>
  );
}

/** "HVAC" for "hvac", "Electrical" for "electrical". */
function tradeName(trade: string): string {
  return trade === "hvac" ? "HVAC" : trade.charAt(0).toUpperCase() + trade.slice(1);
}
