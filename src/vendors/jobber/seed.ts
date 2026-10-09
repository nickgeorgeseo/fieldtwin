import type { NewEvent } from "../../core/types.ts";
import type { World } from "../../world/generate-world.ts";
import { encodeId, type JobberClient } from "./types.ts";

const SEED_TIME = "2020-01-01T00:00:00.000Z";

export function seedJobber(world: World): NewEvent[] {
  const events: NewEvent[] = [
    { vendor: "jobber", type: "AccountCreated", data: { account: { id: encodeId("Account", 1), name: world.company.name } } },
  ];

  world.customers.forEach((person, index) => {
    const client: JobberClient = {
      id: encodeId("Client", index + 1),
      firstName: person.firstName,
      lastName: person.lastName,
      companyName: null,
      emails: [{ address: person.email, primary: true }],
      phones: [{ number: person.phone, primary: true }],
      createdAt: SEED_TIME,
    };
    events.push({ vendor: "jobber", type: "ClientCreated", data: { client } });
  });

  return events;
}
