import { stableUuid } from "../../core/ids.ts";

/**
 * Housecall Pro ids are opaque strings. The reference's samples show a prefix and 32 hex digits for employees
 * (`pro_b9d8d7384b894851b03c1df9a748f653`) and `cus_` for customers, so the twin makes every id that way, with prefixes
 * of its own where the docs show none (FIDELITY.md). Treat them as opaque.
 *
 * An id is derived from its kind and number, never drawn, so the same world and the same requests give the same ids.
 * Numbers count up per kind in the order records are created (state.ts keeps the counts).
 */
export type HcpIdPrefix = "cus" | "adr" | "pro";

export function hcpId(prefix: HcpIdPrefix, n: number): string {
  return `${prefix}_${stableUuid(`housecallpro/${prefix}/${n}`).replaceAll("-", "")}`;
}

/** Housecall Pro's timestamps: UTC ISO 8601 to the second, like the reference's samples ("2026-09-02T14:31:07Z"). */
export function hcpTime(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, "Z");
}
