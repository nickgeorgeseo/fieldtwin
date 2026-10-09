import type { WorldCustomer } from "./generate-world.ts";

/**
 * How far the field-service system and the accounting system have drifted apart, for scenarios that test
 * sync and matching logic. Real businesses have all three kinds:
 *
 *   accountingSpellings  the same person, spelled differently by whoever keyed them into the books
 *                        ("Lindqvist" vs "Lindquist"); the email address is the same in both systems
 *   fieldServiceOnly     new customers with jobs and invoices the books have never seen
 *   accountingOnly       customers the bookkeeper entered directly, with no field work at all
 *
 * Systems are named by role, not vendor: Jobber is the field-service system, QuickBooks the accounting one.
 * Drift picks customers by position, not by random draw, so a world without drift is exactly as before.
 */
export interface DriftOptions {
  renamedInAccounting?: number;
  fieldServiceOnly?: number;
  accountingOnly?: number;
}

export interface WorldDrift {
  accountingSpellings: Record<string, { firstName: string; lastName: string }>;
  fieldServiceOnly: string[];
  accountingOnly: string[];
}

/** Plausible data-entry variants: alternate spellings and one-key typos. None is a name in the word lists. */
const ACCOUNTING_SPELLINGS: Record<string, string> = {
  Alder: "Aldre",
  Brooks: "Brookes",
  Calloway: "Callaway",
  Dunmore: "Dunmoore",
  Ellery: "Ellory",
  Fairbanks: "Fairbank",
  Garrow: "Garow",
  Halvorsen: "Halverson",
  Ingram: "Ingraham",
  Jessup: "Jessop",
  Kettering: "Ketering",
  Lindqvist: "Lindquist",
  Marlow: "Marlowe",
  Northcott: "Northcutt",
  Okafor: "Okafro",
  Pemberton: "Pembreton",
  Quayle: "Quail",
  Rowntree: "Roundtree",
  Stroud: "Stroude",
  Thorne: "Thorn",
};

export function makeDrift(customers: WorldCustomer[], options: DriftOptions = {}): WorldDrift {
  const { renamedInAccounting = 0, fieldServiceOnly = 0, accountingOnly = 0 } = options;
  if (renamedInAccounting + fieldServiceOnly + accountingOnly > customers.length - 1) {
    throw new Error(`World drift: ${customers.length} customers is too few for that much drift`);
  }

  // The last customers are the ones missing from one system; the respelled ones are spread out before them.
  const fromEnd = customers.slice(customers.length - accountingOnly - fieldServiceOnly);
  const rest = customers.slice(0, customers.length - fromEnd.length);
  const step = renamedInAccounting ? Math.max(1, Math.floor(rest.length / renamedInAccounting)) : 1;
  const renamed = Array.from({ length: renamedInAccounting }, (_, i) => rest[(1 + i * step) % rest.length]!);

  return {
    accountingSpellings: Object.fromEntries(
      renamed.map((customer) => [
        customer.key,
        { firstName: customer.firstName, lastName: ACCOUNTING_SPELLINGS[customer.lastName] ?? `${customer.lastName}e` },
      ]),
    ),
    fieldServiceOnly: fromEnd.slice(0, fieldServiceOnly).map((customer) => customer.key),
    accountingOnly: fromEnd.slice(fieldServiceOnly).map((customer) => customer.key),
  };
}
