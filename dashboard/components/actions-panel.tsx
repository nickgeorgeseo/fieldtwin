"use client";

import { useState } from "react";
import { ACTIONS, actionKey } from "@/lib/actions.ts";
import { twinSend } from "@/lib/twin-api.ts";
import { vendorLabel } from "@/lib/vendors.ts";
import { ChangeList } from "./change-list.tsx";
import { useTwin } from "./twin-provider.tsx";
import { Button, Card, NoticeLine, TextInput, VendorBadge } from "./ui.tsx";
import { useAction } from "./use-action.ts";

export function ActionsPanel() {
  const { status } = useTwin();
  const { busy, notice, run } = useAction();
  const [counts, setCounts] = useState<Record<string, string>>(
    Object.fromEntries(ACTIONS.map((entry) => [actionKey(entry), entry.defaultCount])),
  );
  const [happened, setHappened] = useState<string[]>([]);

  const act = (key: string) =>
    run(async () => {
      const result = await twinSend<{ events: string[] }>("POST", `/actions/${key}`, Number(counts[key]));
      setHappened(result.events);
      return result.events.length === 1
        ? "1 thing happened, and its webhooks went out."
        : `${result.events.length} things happened, and their webhooks went out.`;
    });

  return (
    <Card title="Make something happen">
      <ul className="space-y-3">
        {ACTIONS.map(({ vendor, action, label, help }) => {
          const key = actionKey({ vendor, action });
          const ariaName = `${label} (${vendorLabel(vendor)})`;
          return (
            <li key={key} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  {label} <VendorBadge vendor={vendor} />
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{help}</p>
              </div>
              <TextInput
                aria-label={`How many: ${ariaName}`}
                type="number"
                min={1}
                value={counts[key]}
                onChange={(event) => setCounts({ ...counts, [key]: event.target.value })}
                className="w-16"
              />
              <Button aria-label={`Go: ${ariaName}`} disabled={busy || !status} onClick={() => act(key)}>
                Go
              </Button>
            </li>
          );
        })}
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
