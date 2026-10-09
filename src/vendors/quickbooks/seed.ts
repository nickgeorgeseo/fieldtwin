import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import { seedBooks } from "./seed-books.ts";
import type { QboCustomer, QboItem } from "./types.ts";

/** A fixed, obviously fake realm (company) id. */
export const TWIN_REALM_ID = "9341000000000001";

const SEED_TIME = "2020-01-01T00:00:00.000Z";

export function seedQuickBooks(world: World): NewEvent[] {
  const events: NewEvent[] = [{ vendor: "quickbooks", type: "CompanyCreated", data: { realmId: TWIN_REALM_ID } }];

  const customers = world.customers.map(
    (person, index): QboCustomer => ({
      Id: String(index + 1),
      SyncToken: "0",
      DisplayName: `${person.firstName} ${person.lastName}`,
      GivenName: person.firstName,
      FamilyName: person.lastName,
      PrimaryEmailAddr: { Address: person.email },
      PrimaryPhone: { FreeFormNumber: person.phone },
      BillAddr: { Line1: person.street, City: person.city, CountrySubDivisionCode: person.state, PostalCode: person.postalCode },
      Active: true,
      MetaData: { CreateTime: SEED_TIME, LastUpdatedTime: SEED_TIME },
    }),
  );
  for (const customer of customers) events.push({ vendor: "quickbooks", type: "CustomerCreated", data: { customer } });

  // The price list becomes Items: services as Service, parts as NonInventory (sold, not stocked).
  world.catalog.forEach((entry, index) => {
    const item: QboItem = {
      Id: String(index + 1),
      SyncToken: "0",
      Name: entry.name,
      FullyQualifiedName: entry.name,
      Type: entry.kind === "service" ? "Service" : "NonInventory",
      Description: entry.description,
      UnitPrice: entry.unitPrice,
      Taxable: entry.kind === "part",
      TrackQtyOnHand: false,
      Active: true,
      MetaData: { CreateTime: SEED_TIME, LastUpdatedTime: SEED_TIME },
    };
    events.push({ vendor: "quickbooks", type: "ItemCreated", data: { item } });
  });

  events.push(...seedBooks(world, customers));
  return events;
}
