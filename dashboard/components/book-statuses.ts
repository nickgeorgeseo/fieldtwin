import type { CustomerStatus, InvoiceStatus } from "@/lib/match-books.ts";
import type { BadgeTone } from "./ui.tsx";

/** How each kind of agreement or drift is named and colored: red needs a sync, amber needs a look, green is fine. */

export const CUSTOMER_STATUSES: Record<CustomerStatus, { label: string; tone: BadgeTone; help: string }> = {
  "only-in-jobber": { label: "Only in Jobber", tone: "red", help: "A customer with work the books have never seen" },
  "only-in-quickbooks": { label: "Only in QuickBooks", tone: "neutral", help: "Entered in the books, with no field work" },
  "inactive-in-quickbooks": {
    label: "Inactive in QuickBooks",
    tone: "amber",
    help: "Made inactive in the books; a lookup of active customers misses them",
  },
  "spelled-differently": { label: "Spelled differently", tone: "amber", help: "Same email, different name" },
  same: { label: "Same in both", tone: "green", help: "Same email, same name" },
};

export const INVOICE_STATUSES: Record<InvoiceStatus, { label: string; tone: BadgeTone; help: string }> = {
  "paid-not-booked": { label: "Paid, not in the books", tone: "red", help: "Paid in Jobber, never booked in QuickBooks" },
  "payment-not-recorded": { label: "Payment not recorded", tone: "red", help: "Paid in Jobber, still open in QuickBooks" },
  "totals-differ": { label: "Totals differ", tone: "red", help: "The two systems disagree about the amount" },
  "paid-only-in-quickbooks": { label: "Paid only in QuickBooks", tone: "amber", help: "Closed in the books, still open in Jobber" },
  "open-not-booked": {
    label: "Open, not in the books",
    tone: "amber",
    help: "Not paid yet; a sync that books paid invoices leaves it for now",
  },
  "only-in-quickbooks": { label: "Only in QuickBooks", tone: "neutral", help: "A QuickBooks invoice with no Jobber number" },
  "in-sync": { label: "In sync", tone: "green", help: "Same total, and paid or open in both" },
};

const DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function money(amount: number | undefined): string {
  return amount === undefined ? "" : DOLLARS.format(amount);
}
