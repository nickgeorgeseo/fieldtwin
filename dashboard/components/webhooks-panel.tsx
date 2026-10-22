"use client";

import { useEffect, useState } from "react";
import { twinGet, twinSend } from "@/lib/twin-api.ts";
import { formatTwinTime } from "@/lib/twin-time.ts";
import type { Delivery, WebhookReport } from "@/lib/twin-types.ts";
import { useTwin } from "./twin-provider.tsx";
import { Badge, type BadgeTone, Button, Card, NoticeLine, VendorBadge } from "./ui.tsx";
import { useAction } from "./use-action.ts";

const EXAMPLE = `[
  {
    "vendor": "jobber",
    "url": "http://localhost:3000/webhooks/jobber",
    "topics": ["INVOICE_UPDATE", "CLIENT_CREATE"],
    "clientId": "my-app",
    "clientSecret": "dev"
  },
  {
    "vendor": "housecallpro",
    "url": "http://localhost:3000/webhooks/hcp",
    "topics": ["invoice.paid", "customer.created"],
    "clientId": "my-app",
    "clientSecret": "my-signing-secret"
  }
]`;

const STATUS_TONES: Record<Delivery["status"], BadgeTone> = { delivered: "green", pending: "amber", failed: "red" };

/** Where the twin sends webhooks, and how each delivery went (GET and PUT /_twin/webhooks). */
export function WebhooksPanel() {
  const { status, logKey } = useTwin();
  const { busy, notice, run } = useAction();
  const [report, setReport] = useState<WebhookReport | null>(null);
  const [text, setText] = useState(EXAMPLE);
  const offset = status?.company.utcOffsetHours ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: deliveries happen as the log grows and time passes, which logKey tracks
  useEffect(() => {
    twinGet<WebhookReport>("/webhooks").then(setReport, () => setReport(null));
  }, [logKey, notice]);

  const subscribe = (subscriptions: unknown) =>
    run(async () => {
      const result = await twinSend<WebhookReport>("PUT", "/webhooks", subscriptions);
      return result.subscriptions.length
        ? `${result.subscriptions.length} subscription${result.subscriptions.length === 1 ? "" : "s"} set.`
        : "No subscriptions: the twin sends no webhooks.";
    });
  const deliveries = [...(report?.deliveries ?? [])].sort((a, b) => b.id - a.id).slice(0, 50);

  return (
    <Card title="Webhooks">
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Subscriptions</h3>
          {report?.subscriptions.length ? (
            <ul className="space-y-2 text-sm">
              {report.subscriptions.map((subscription) => (
                <li key={`${subscription.vendor}-${subscription.url}`} className="space-y-1">
                  <p className="flex items-center gap-2">
                    <VendorBadge vendor={subscription.vendor} /> <span className="truncate font-mono text-xs">{subscription.url}</span>
                  </p>
                  <p className="flex flex-wrap gap-1">
                    {subscription.topics.map((topic) => (
                      <Badge key={topic}>{topic}</Badge>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">None. Subscribe your app's webhook URL below.</p>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-zinc-600 dark:text-zinc-300">Set subscriptions</summary>
            <textarea
              aria-label="Webhook subscriptions (JSON)"
              value={text}
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              rows={10}
              className="mt-2 w-full rounded-md border border-zinc-300 bg-zinc-50 p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
            <p className="text-xs text-zinc-500">Replaces every subscription. Secrets sign deliveries and are never shown back.</p>
            <div className="mt-2 flex gap-2">
              <Button tone="primary" disabled={busy || !status} onClick={() => subscribe(parseOrText(text))}>
                Subscribe
              </Button>
              <Button tone="danger" disabled={busy || !report?.subscriptions.length} onClick={() => subscribe([])}>
                Remove all
              </Button>
            </div>
          </details>
          <NoticeLine notice={notice} />
        </div>
        <div className="overflow-x-auto lg:col-span-2">
          <h3 className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">Latest deliveries</h3>
          {deliveries.length ? (
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="text-zinc-500">
                <tr>
                  {["Due", "Vendor", "Topic", "Item", "Tries", "Status", "Last answer", "Fault"].map((heading) => (
                    <th key={heading} className="pb-1.5 pr-3 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {deliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <td className="py-1.5 pr-3 font-mono tabular-nums">{formatTwinTime(delivery.dueAt, offset).time}</td>
                    <td className="pr-3">
                      <VendorBadge vendor={delivery.vendor} />
                    </td>
                    <td className="pr-3 font-mono">{delivery.topic}</td>
                    <td className="max-w-32 truncate pr-3 font-mono" title={delivery.itemId}>
                      {delivery.itemId}
                    </td>
                    <td className="pr-3 tabular-nums">{delivery.attempts}</td>
                    <td className="pr-3">
                      <Badge tone={STATUS_TONES[delivery.status]}>{delivery.status}</Badge>
                    </td>
                    <td className="pr-3">{delivery.lastAnswer ?? ""}</td>
                    <td>{delivery.fault && <Badge tone="red">{delivery.fault}</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-zinc-500">No deliveries yet. Subscribe, then make customers pay or new clients call in.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** The JSON written, or the text itself, so the twin's own error explains what's wrong with it. */
function parseOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
