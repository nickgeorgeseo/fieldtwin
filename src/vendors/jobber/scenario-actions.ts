import type { ScenarioAction } from "../../core/vendor-twin.ts";
import { newCustomer } from "../../world/generate-world.ts";
import { encodeId, nextIdNumber } from "./encoded-id.ts";
import { clientName, type JobberClient, type JobberState } from "./types.ts";

/**
 * What a scenario timeline can make happen in Jobber. Each returns complete events; the twin records them
 * with source "scenario" when the entry is due.
 *
 *   jobber: { newClients: 15 }   fifteen new clients arrive (new requests, phone calls, online bookings)
 *   jobber: { payInvoices: 2 }   the two longest-open invoices get paid
 */
export const jobberScenarioActions: Record<string, ScenarioAction<JobberState>> = {
  newClients: {
    check: (count) => checkCount("newClients", count),
    run: (count, { state, world, random, nowIso }) => {
      const taken = new Set([...state.clients.values()].map(clientName));
      const firstNumber = nextIdNumber(state.clients.keys(), "Client");
      return Array.from({ length: count as number }, (_, index) => {
        const person = newCustomer(random, world, firstNumber + index, taken);
        taken.add(`${person.firstName} ${person.lastName}`);
        const client: JobberClient = {
          id: encodeId("Client", firstNumber + index),
          firstName: person.firstName,
          lastName: person.lastName,
          companyName: null,
          emails: [{ address: person.email, primary: true }],
          phones: [{ number: person.phone, primary: true }],
          createdAt: nowIso,
        };
        return { vendor: "jobber", type: "ClientCreated", data: { client } };
      });
    },
  },

  payInvoices: {
    check: (count) => checkCount("payInvoices", count),
    run: (count, { state, nowIso }) =>
      [...state.invoices.values()]
        .filter((invoice) => !invoice.paidAt)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, count as number)
        .map((invoice) => ({
          vendor: "jobber",
          type: "InvoiceUpdated",
          data: { invoice: { ...invoice, paidAt: nowIso, updatedAt: nowIso } },
        })),
  },
};

function checkCount(action: string, value: unknown): void {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`jobber ${action} needs a whole number of 1 or more, like { ${action}: 5 }. Got: ${JSON.stringify(value)}`);
  }
}
