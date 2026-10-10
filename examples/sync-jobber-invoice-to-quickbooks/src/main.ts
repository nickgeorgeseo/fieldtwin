import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { endpointsAt } from "./endpoints.ts";
import { InvoiceQueue } from "./invoice-queue.ts";
import { createJobberClient } from "./jobber.ts";
import { TokenManager, type VendorOAuth } from "./oauth.ts";
import { createQuickBooksClient } from "./quickbooks.ts";
import type { Fetch } from "./runtime.ts";
import { type SyncStats, syncPaidInvoice, syncPaidInvoices } from "./sync.ts";
import { connectWithoutBrowser, subscribeToWebhooks, twinAction, twinRuntime } from "./twin.ts";
import { jobberWebhookHandler } from "./webhooks.ts";

/**
 * The demo: sync paid Jobber invoices into QuickBooks against a running fieldtwin.
 *
 *   npm start                  # in one terminal: the twin (try FIELDTWIN_AUTH=oauth, or -- flaky-apis)
 *   npm run example:sync       # in another: this file
 *
 * It syncs every paid invoice, syncs again two hours later from where it left off, then subscribes to webhooks
 * and syncs the invoices customers pay as the news arrives. FIELDTWIN_URL points it at a twin somewhere other
 * than http://localhost:4010. Production wiring (real endpoints, a real consent page, saved tokens, a public
 * webhook URL, and a schedule) is in README.md.
 */

const EVER = "1970-01-01T00:00:00Z";
const HOUR = 3_600_000;

// The twin accepts any client credentials. In production these come from each vendor's developer portal.
const QUICKBOOKS_APP = { clientId: "sync-example", clientSecret: "not-a-secret", clientAuthentication: "basic" } as const;
const JOBBER_APP = { clientId: "sync-example", clientSecret: "not-a-secret", clientAuthentication: "body" } as const;

export async function runDemo(baseUrl: string, log: (line: string) => void = console.log, fetchImpl?: Fetch) {
  const runtime = await twinRuntime(baseUrl, log, fetchImpl);
  const endpoints = endpointsAt(baseUrl);
  const quickbooksOAuth: VendorOAuth = { ...QUICKBOOKS_APP, tokenUrl: endpoints.quickbooks.tokenUrl };
  const jobberOAuth: VendorOAuth = { ...JOBBER_APP, tokenUrl: endpoints.jobber.tokenUrl };

  const quickbooksConnection = await connectWithoutBrowser("quickbooks", endpoints, quickbooksOAuth, runtime);
  const jobberConnection = await connectWithoutBrowser("jobber", endpoints, jobberOAuth, runtime);
  const realmId = quickbooksConnection.realmId!;
  log(`Connected to QuickBooks (company ${realmId}) and Jobber at ${baseUrl}.`);

  const clients = {
    jobber: createJobberClient({
      apiUrl: endpoints.jobber.apiUrl,
      tokens: new TokenManager(jobberOAuth, jobberConnection.tokens, runtime),
      runtime,
    }),
    quickbooks: createQuickBooksClient({
      apiBase: endpoints.quickbooks.apiBase,
      realmId,
      tokens: new TokenManager(quickbooksOAuth, quickbooksConnection.tokens, runtime),
      runtime,
    }),
    log,
  };

  const firstRunAt = new Date(runtime.now()).toISOString();
  log("Run 1: every paid Jobber invoice.");
  const first = await syncPaidInvoices(clients, EVER);
  report(first, log);

  await runtime.sleep(2 * HOUR); // advances the twin's clock; the access tokens expire on the way
  log(`Run 2, two hours of twin time later: invoices paid since run 1 began (${firstRunAt}), with refreshed tokens.`);
  const second = await syncPaidInvoices(clients, firstRunAt);
  report(second, log);

  // Run 3: react instead of polling. A real app subscribes in Jobber's Developer Center; the twin's equivalent is
  // its control plane. Customers pay, Jobber tells the app, and the app syncs just those invoices.
  log("Run 3, from webhooks: subscribed to INVOICE_UPDATE, two customers pay.");
  const queue = new InvoiceQueue((invoiceId) => syncPaidInvoice(clients, invoiceId), log);
  const receiver = await listen(jobberWebhookHandler({ clientSecret: JOBBER_APP.clientSecret, onEvent: (event) => queue.add(event) }));
  const { clientId, clientSecret } = JOBBER_APP;
  try {
    await subscribeToWebhooks(baseUrl, runtime.fetch, [
      { vendor: "jobber", url: `${receiver.url}/webhooks/jobber`, topics: ["INVOICE_UPDATE"], clientId, clientSecret },
    ]);
    await twinAction(baseUrl, runtime.fetch, "jobber", "payInvoices", 2); // resolves once the webhooks were answered
    await runtime.sleep(10 * 60_000); // any late deliveries (flaky-apis delays some) arrive meanwhile
    await queue.idle();
    report(queue.totals, log);
  } finally {
    await subscribeToWebhooks(baseUrl, runtime.fetch, []);
    receiver.close();
  }
  return { first, second, third: queue.totals };
}

/** Serve a request handler on a free local port, where your web server would serve it at a public URL. */
function listen(handler: (request: Request) => Promise<Response>): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = serve({ fetch: handler, port: 0, hostname: "127.0.0.1" }, ({ port }) =>
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() }),
    );
  });
}

function report(stats: SyncStats, log: (line: string) => void): void {
  log(
    `  ${stats.invoices} paid invoices: ${stats.invoicesCreated} booked, ${stats.paymentsCreated} payments recorded, ` +
      `${stats.invoicesStamped} stamped, ${stats.customersCreated} customers created, ` +
      `${stats.customersSpelledDifferently} matched despite a different spelling, ${stats.staleRetries} stale SyncTokens recovered, ` +
      `${stats.conflicts} conflicts, ${stats.failed} failed.`,
  );
}

// pathToFileURL, not `file://${path}`: the path may hold spaces (percent-encoded in the URL) or be a Windows path.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const baseUrl = process.env.FIELDTWIN_URL ?? "http://localhost:4010";
  runDemo(baseUrl).catch((error: Error) => {
    const hint = error instanceof TypeError ? ` Is fieldtwin running at ${baseUrl}? Start it with npm start.` : "";
    console.error(`sync example: ${error.message}.${hint}`);
    process.exitCode = 1;
  });
}
