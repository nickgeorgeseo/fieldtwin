import { endpointsAt } from "./endpoints.ts";
import { createJobberClient } from "./jobber.ts";
import { TokenManager, type VendorOAuth } from "./oauth.ts";
import { createQuickBooksClient } from "./quickbooks.ts";
import type { Fetch } from "./runtime.ts";
import { type SyncStats, syncPaidInvoices } from "./sync.ts";
import { connectWithoutBrowser, twinRuntime } from "./twin.ts";

/**
 * The demo: sync paid Jobber invoices into QuickBooks against a running fieldtwin.
 *
 *   npm start                  # in one terminal: the twin (try FIELDTWIN_AUTH=oauth, or -- scenarios/flaky-apis.yaml)
 *   npm run example:sync       # in another: this file
 *
 * FIELDTWIN_URL points it at a twin somewhere other than http://localhost:4010. Production wiring, where the
 * only differences are real endpoints, a real consent page, saved tokens, and a schedule, is in README.md.
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
  return { first, second };
}

function report(stats: SyncStats, log: (line: string) => void): void {
  log(
    `  ${stats.invoices} paid invoices: ${stats.invoicesCreated} booked, ${stats.paymentsCreated} payments recorded, ` +
      `${stats.invoicesStamped} stamped, ${stats.customersCreated} customers created, ` +
      `${stats.customersSpelledDifferently} matched despite a different spelling, ${stats.staleRetries} stale SyncTokens recovered, ` +
      `${stats.conflicts} conflicts, ${stats.failed} failed.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl = process.env.FIELDTWIN_URL ?? "http://localhost:4010";
  runDemo(baseUrl).catch((error: Error) => {
    const hint = error instanceof TypeError ? ` Is fieldtwin running at ${baseUrl}? Start it with npm start.` : "";
    console.error(`sync example: ${error.message}.${hint}`);
    process.exitCode = 1;
  });
}
