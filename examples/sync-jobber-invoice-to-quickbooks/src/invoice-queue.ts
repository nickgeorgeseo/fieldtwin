import { OAuthError } from "./oauth.ts";
import { emptyStats, type SyncStats } from "./sync.ts";
import type { JobberWebhookEvent } from "./webhooks.ts";

/**
 * The background half of webhook handling: invoices to sync, one at a time, each once per burst of news.
 *
 * Webhooks only say "invoice X changed", often more than once (a payment fires INVOICE_UPDATE twice, and delivery
 * is at least once), and not necessarily in order. So the queue keeps invoice ids, not events: news about an
 * invoice already waiting is folded into it, and each sync reads the invoice as it is when its turn comes. An
 * invoice whose sync fails goes to the back of the queue, up to three tries; after that the scheduled sync, which
 * production keeps running as a safety net, picks it up.
 *
 * In production this is a job queue (a database table, SQS, BullMQ); in memory is enough for the demo and tests.
 */
const MAX_TRIES = 3;

export class InvoiceQueue {
  readonly totals: SyncStats = emptyStats(); // `invoices` counts distinct paid invoices, however often each was synced
  private synced = new Set<string>();
  private waiting = new Map<string, number>(); // invoice id -> tries so far
  private draining: Promise<void> = Promise.resolve();

  constructor(
    private readonly sync: (invoiceId: string) => Promise<SyncStats>,
    private readonly log: (line: string) => void,
  ) {}

  /** Take in a webhook. Only INVOICE_UPDATE concerns the sync; a repeat of news already waiting changes nothing. */
  add(event: JobberWebhookEvent): void {
    if (event.topic !== "INVOICE_UPDATE" || this.waiting.has(event.itemId)) return;
    this.waiting.set(event.itemId, 0);
    this.draining = this.draining.then(() => this.drain());
  }

  /** Resolves once everything queued so far has been synced (or given up on). */
  idle(): Promise<void> {
    return this.draining;
  }

  private async drain(): Promise<void> {
    for (const [invoiceId, tries] of this.waiting) {
      this.waiting.delete(invoiceId);
      let stats: SyncStats;
      try {
        stats = await this.sync(invoiceId);
      } catch (error) {
        if (error instanceof OAuthError) throw error; // the connection is gone; nothing else will work either
        stats = { ...emptyStats(), failed: 1 };
        this.log(`Invoice ${invoiceId} from a webhook: ${error instanceof Error ? error.message : String(error)}`);
      }
      for (const key of Object.keys(this.totals) as (keyof SyncStats)[]) if (key !== "invoices") this.totals[key] += stats[key];
      if (stats.invoices > 0) this.synced.add(invoiceId);
      this.totals.invoices = this.synced.size;
      if (stats.failed > 0 && tries + 1 < MAX_TRIES) this.waiting.set(invoiceId, tries + 1);
    }
  }
}
