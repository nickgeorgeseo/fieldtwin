import type { setup } from "./helpers.ts";

/** What the Housecall Pro tests share: the world's money as cents, its times as the API writes them, and whole lists. */

type Harness = ReturnType<typeof setup>;

/** A world record's lines in cents, as Housecall Pro answers every amount. */
export const cents = (record: { lineItems: { quantity: number; unitPrice: number }[] }) =>
  record.lineItems.reduce((total, line) => total + Math.round(line.quantity * line.unitPrice * 100), 0);

/** A world time as Housecall Pro writes it: to the second. */
export const iso = (time: string) => time.replace(".000Z", "Z");

/** Every record of a list on one page: `listAll<Invoice>(hcpGet, "invoices", "&status[]=paid")`. */
export async function listAll<T>(hcpGet: Harness["hcpGet"], name: string, query = ""): Promise<T[]> {
  return (await (await hcpGet(`/${name}?page_size=1000${query}`)).json())[name];
}
