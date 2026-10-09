import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import type { QboCustomer } from "./types.ts";

/** A fixed, obviously fake realm (company) id. */
export const TWIN_REALM_ID = "9341000000000001";

const SEED_TIME = "2020-01-01T00:00:00.000Z";

export function seedQuickBooks(world: World): NewEvent[] {
  const events: NewEvent[] = [{ vendor: "quickbooks", type: "CompanyCreated", data: { realmId: TWIN_REALM_ID } }];

  world.customers.forEach((person, index) => {
    const customer: QboCustomer = {
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
    };
    events.push({ vendor: "quickbooks", type: "CustomerCreated", data: { customer } });
  });

  return events;
}
