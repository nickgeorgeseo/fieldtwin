/**
 * What the control room can make happen now, as if done in the vendor's own app (POST /_twin/actions/:vendor/:action):
 * the actions a scenario timeline runs (README "Scenarios and faults"). Two vendors can name an action the same way,
 * Jobber and Housecall Pro both pay invoices, so an action is known by its vendor and its name together.
 */

export interface TwinAction {
  vendor: string;
  action: string;
  label: string;
  help: string;
  initial: string; // the count the field starts with
}

export const ACTIONS: TwinAction[] = [
  { vendor: "jobber", action: "payInvoices", label: "Customers pay", help: "The longest-open invoices get paid", initial: "2" },
  {
    vendor: "jobber",
    action: "newClients",
    label: "New clients call in",
    help: "New clients, as from calls and online bookings",
    initial: "3",
  },
  { vendor: "housecallpro", action: "newCustomers", label: "New customers call in", help: "People new to the business", initial: "3" },
  {
    vendor: "housecallpro",
    action: "completeJobs",
    label: "Techs finish jobs",
    help: "The jobs whose visits began first, once every visit has begun",
    initial: "2",
  },
  {
    vendor: "housecallpro",
    action: "invoiceJobs",
    label: "Finished work is invoiced",
    help: "Sent at once, finished longest ago first",
    initial: "2",
  },
  {
    vendor: "housecallpro",
    action: "payInvoices",
    label: "Customers pay",
    help: "The invoices due longest ago get paid in full",
    initial: "2",
  },
];

export function actionKey({ vendor, action }: Pick<TwinAction, "vendor" | "action">): string {
  return `${vendor}/${action}`;
}
