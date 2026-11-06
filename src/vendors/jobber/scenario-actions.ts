import { checkCount, type ScenarioAction } from "../../core/vendor-twin.ts";
import { MOST_NEW_CUSTOMERS, newCustomers } from "../../world/generate-world.ts";
import { encodeId, nextIdNumber } from "./encoded-id.ts";
import type { JobberClient, JobberState } from "./types.ts";

/**
 * What a scenario timeline can make happen in Jobber. Each returns complete events; the twin records them
 * with source "scenario" when the entry is due.
 *
 *   jobber: { newClients: 15 }   fifteen new clients arrive (new requests, phone calls, online bookings)
 *   jobber: { payInvoices: 2 }   the two longest-open invoices get paid
 */
export const jobberScenarioActions: Record<string, ScenarioAction<JobberState>> = {
  newClients: {
    check: (count) => checkCount("jobber", "newClients", count, MOST_NEW_CUSTOMERS),
    run: (count, { state, world, random, nowIso }) => {
      const firstNumber = nextIdNumber(state.clients.keys(), "Client");
      // The person's own name, not Client.name: a business client's name is its company, and the person who works
      // there still shouldn't share a name with a newcomer.
      const takenNames = [...state.clients.values()].map((client) => `${client.firstName} ${client.lastName}`);
      const people = newCustomers(random, world, { firstNumber, count: count as number }, takenNames);
      return people.map((person, index) => {
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
    check: (count) => checkCount("jobber", "payInvoices", count),
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
