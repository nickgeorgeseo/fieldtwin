"use client";

import { useState } from "react";
import { twinSend } from "@/lib/twin-api.ts";
import { ChangeList } from "./change-list.tsx";
import { useTwin } from "./twin-provider.tsx";
import { Button, Card, NoticeLine, TextInput, VendorBadge } from "./ui.tsx";
import { useAction } from "./use-action.ts";

/** The things a scenario timeline can make happen, now, as if done in the vendor's own app (POST /_twin/actions). */
const ACTIONS = [
  { vendor: "jobber", action: "payInvoices", label: "Customers pay", help: "The longest-open invoices get paid", initial: "2" },
  {
    vendor: "jobber",
    action: "newClients",
    label: "New clients call in",
    help: "New clients, as from calls and online bookings",
    initial: "3",
  },
];

export function ActionsPanel() {
  const { status } = useTwin();
  const { busy, notice, run } = useAction();
  const [counts, setCounts] = useState<Record<string, string>>(Object.fromEntries(ACTIONS.map(({ action, initial }) => [action, initial])));
  const [happened, setHappened] = useState<string[]>([]);

  const act = (vendor: string, action: string) =>
    run(async () => {
      const result = await twinSend<{ events: string[] }>("POST", `/actions/${vendor}/${action}`, Number(counts[action]));
      setHappened(result.events);
      return result.events.length === 1
        ? "1 thing happened, and its webhooks went out."
        : `${result.events.length} things happened, and their webhooks went out.`;
    });

  return (
    <Card title="Make something happen">
      <ul className="space-y-3">
        {ACTIONS.map(({ vendor, action, label, help }) => (
          <li key={action} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {label} <VendorBadge vendor={vendor} />
              </p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">{help}</p>
            </div>
            <TextInput
              aria-label={`How many: ${label}`}
              type="number"
              min={1}
              value={counts[action]}
              onChange={(event) => setCounts({ ...counts, [action]: event.target.value })}
              className="w-16"
            />
            <Button aria-label={`Go: ${label}`} disabled={busy || !status} onClick={() => act(vendor, action)}>
              Go
            </Button>
          </li>
        ))}
      </ul>
      <NoticeLine notice={notice} />
      {happened.length > 0 && (
        <div className="mt-2 max-h-48 overflow-y-auto">
          <ChangeList summaries={happened} utcOffsetHours={status?.company.utcOffsetHours ?? 0} empty="" />
        </div>
      )}
    </Card>
  );
}
