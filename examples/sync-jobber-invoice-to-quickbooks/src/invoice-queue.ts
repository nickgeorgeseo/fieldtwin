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
 * A lost connection (OAuthError: the refresh token was revoked or rotated away) stops the queue rather than failing
 * every invoice in turn. What hadn't synced stays queued, news keeps being taken in, and resume() carries on once the
 * person has connected the app again. The queue never rejects, so a web server running it can't crash on one.
 *
 * In production this is a job queue (a database table, SQS, BullMQ); in memory is enough for the demo and tests.
 */
const MAX_TRIES = 3;

export class InvoiceQueue {
  readonly totals: SyncStats = emptyStats(); // `invoices` counts distinct paid invoices, however often each was synced
  private synced = new Set<string>();
  private waiting = new Map<string, number>(); // invoice id -> tries so far
  private draining: Promise<void> = Promise.resolve();
  /** Why the queue stopped, if it has: nothing is tried until resume(). */
  connectionLost: OAuthError | undefined;

  constructor(
    private readonly sync: (invoiceId: string) => Promise<SyncStats>,
    private readonly log: (line: string) => void,
  ) {}

  /** Take in a webhook. Only INVOICE_UPDATE concerns the sync; a repeat of news already waiting changes nothing. */
  add(event: JobberWebhookEvent): void {
    if (event.topic !== "INVOICE_UPDATE" || this.waiting.has(event.itemId)) return;
    this.waiting.set(event.itemId, 0);
    this.drainLater();
  }

  /** After the person has connected the app again: sync what waited meanwhile. */
  resume(): void {
    this.connectionLost = undefined;
    this.drainLater();
  }

  /** Resolves once everything queued so far has been synced, given up on, or left waiting for resume(). Never rejects. */
  idle(): Promise<void> {
    return this.draining;
  }

  private drainLater(): void {
    if (this.connectionLost) return;
    this.draining = this.draining.then(() => this.drain()).catch((error) => this.log(`Webhook queue: ${String(error)}`));
  }

  private async drain(): Promise<void> {
    for (const [invoiceId, tries] of this.waiting) {
      if (this.connectionLost) return;
      this.waiting.delete(invoiceId);
      let stats: SyncStats;
      try {
        stats = await this.sync(invoiceId);
      } catch (error) {
        if (error instanceof OAuthError) {
          // The connection is gone, so nothing else would work either: keep this invoice and stop until resume().
          this.waiting.set(invoiceId, tries);
          this.connectionLost = error;
          this.log(`Webhook syncs paused until the app is connected again: ${error.message}`);
          return;
        }
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
