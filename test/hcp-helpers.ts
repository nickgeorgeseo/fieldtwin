import type { setup } from "./helpers.ts";

/** What the Housecall Pro tests share: the world's money as cents, its times as the API writes them, and whole lists. */

type Harness = ReturnType<typeof setup>;

/** A customer with their address, and two employees, to create jobs for. */
export async function jobCast(harness: Harness) {
  const customer = (await (await harness.hcpGet("/customers?page_size=1")).json()).customers[0] as {
    id: string;
    addresses: { id: string }[];
  };
  const employees = (await (await harness.hcpGet("/employees")).json()).employees as { id: string; first_name: string }[];
  return { customerId: customer.id, addressId: customer.addresses[0]!.id, employees };
}

/** A two-hour visit with an hour's arrival window, as Create a Job takes one. */
export const SCHEDULE = { scheduled_start: "2026-07-20T14:00:00", scheduled_end: "2026-07-20T16:00:00", arrival_window: 60 };

/** A world record's lines in cents, as Housecall Pro answers every amount. */
export const cents = (record: { lineItems: { quantity: number; unitPrice: number }[] }) =>
  record.lineItems.reduce((total, line) => total + Math.round(line.quantity * line.unitPrice * 100), 0);

/** A world time as Housecall Pro writes it: to the second. */
export const iso = (time: string) => time.replace(".000Z", "Z");

/** Every record of a list on one page: `listAll<Invoice>(hcpGet, "invoices", "&status[]=paid")`. */
export async function listAll<T>(hcpGet: Harness["hcpGet"], name: string, query = ""): Promise<T[]> {
  return (await (await hcpGet(`/${name}?page_size=1000${query}`)).json())[name];
}
