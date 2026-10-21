import { stableUuid } from "../../core/ids.ts";

/**
 * Housecall Pro ids are opaque strings. The reference's samples show a prefix and 32 hex digits for employees
 * (`pro_b9d8d7384b894851b03c1df9a748f653`), `cus_` for customers, and `invoice_` for invoices, so the twin makes every id
 * that way, with prefixes of its own where the docs show none (FIDELITY.md). Treat them as opaque.
 *
 * An id is derived from its kind and number, never drawn, so the same world and the same requests give the same ids.
 * Numbers count up per kind in the order records are created (state.ts keeps the counts).
 */
export type HcpIdPrefix = "cus" | "adr" | "pro" | "job" | "li" | "appt" | "note" | "est" | "opt" | "invoice" | "pmt";

export function hcpId(prefix: HcpIdPrefix, n: number | string): string {
  const key = `housecallpro/${prefix}/${n}`;
  let id = made.get(key);
  if (id === undefined) {
    id = `${prefix}_${stableUuid(key).replaceAll("-", "")}`;
    made.set(key, id);
  }
  return id;
}

// Every reset seeds the same ids again, and each one is a hash, so each is worked out once. Numbering starts over on a
// reset, so this holds no more ids than the largest world the process has had.
const made = new Map<string, string>();
