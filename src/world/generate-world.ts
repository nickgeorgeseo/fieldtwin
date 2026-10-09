import type { SeededRandom } from "../core/random.ts";
import { type CatalogEntry, makeCatalog } from "./catalog.ts";
import { makeHistory, type WorldHistory } from "./history.ts";
import { CITIES, FIRST_NAMES, LAST_NAMES, STREET_NAMES, TRADES } from "./word-lists.ts";

/**
 * The fake business that every vendor twin describes.
 *
 * The world is vendor-neutral on purpose. Each vendor turns it into its own records
 * in its own shape (see each vendor's seed.ts). The twins do NOT sync with each other
 * after that: keeping Jobber and QuickBooks in sync is the job of the code under test.
 */
export interface World {
  asOf: string; // the moment the world describes: history is before it, the schedule after it
  company: { name: string; trade: string; city: string; state: string; utcOffsetHours: number };
  customers: WorldCustomer[];
  technicians: WorldTechnician[];
  catalog: CatalogEntry[];
  history: WorldHistory;
}

export interface WorldCustomer {
  key: string; // stable id inside the world, e.g. "cust-007". Vendors make their own ids.
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface WorldTechnician {
  key: string;
  firstName: string;
  lastName: string;
}

export interface WorldSize {
  customers: number;
  technicians: number;
}

const DEFAULT_SIZE: WorldSize = { customers: 25, technicians: 4 };

export interface WorldOptions {
  startTime: string; // history is laid out around this moment: the past behind it, the schedule ahead
  size?: Partial<WorldSize>;
}

export function generateWorld(random: SeededRandom, options: WorldOptions): World {
  const { customers, technicians } = { ...DEFAULT_SIZE, ...options.size };
  const home = random.pick(CITIES);
  const trade = random.pick(TRADES);
  const ownerLastName = random.pick(LAST_NAMES);

  // Order matters: each part draws from the same random stream, so new parts of the world go last.
  // That way an existing seed keeps the same company, customers, and technicians when the world grows.
  const company = {
    name: `${ownerLastName} ${trade.businessSuffix}`,
    trade: trade.name,
    city: home.city,
    state: home.state,
    utcOffsetHours: home.utcOffsetHours,
  };
  const customerList = makeCustomers(random, customers, home);
  const technicianList = Array.from({ length: technicians }, (_, i) => ({
    key: `tech-${pad(i + 1)}`,
    firstName: random.pick(FIRST_NAMES),
    lastName: random.pick(LAST_NAMES),
  }));
  const catalog = makeCatalog(random, trade.name);
  const history = makeHistory({
    random,
    customers: customerList,
    technicians: technicianList,
    catalog,
    startMs: Date.parse(options.startTime),
    utcOffsetHours: home.utcOffsetHours,
  });

  return { asOf: options.startTime, company, customers: customerList, technicians: technicianList, catalog, history };
}

type Home = { city: string; state: string; zipPrefix: string };

/** Customer names are unique, because some vendors (QuickBooks) reject duplicate display names. */
function makeCustomers(random: SeededRandom, count: number, home: Home): WorldCustomer[] {
  const maxUnique = FIRST_NAMES.length * LAST_NAMES.length;
  if (count > maxUnique) throw new Error(`World size: at most ${maxUnique} customers with the current word lists`);

  const usedNames = new Set<string>();
  const customers: WorldCustomer[] = [];
  while (customers.length < count) {
    const firstName = random.pick(FIRST_NAMES);
    const lastName = random.pick(LAST_NAMES);
    if (usedNames.has(`${firstName} ${lastName}`)) continue;
    usedNames.add(`${firstName} ${lastName}`);
    customers.push(makeCustomer(random, customers.length + 1, firstName, lastName, home));
  }
  return customers;
}

/**
 * Someone new to the business, for scenario timelines ("15 new clients by 9 a.m."): local to the world's
 * city, with a name nobody in `takenNames` has ("First Last"), numbered `n` so their email is unique.
 */
export function newCustomer(random: SeededRandom, world: World, n: number, takenNames: Set<string>): WorldCustomer {
  const home = CITIES.find((city) => city.city === world.company.city)!;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const firstName = random.pick(FIRST_NAMES);
    const lastName = random.pick(LAST_NAMES);
    if (!takenNames.has(`${firstName} ${lastName}`)) return makeCustomer(random, n, firstName, lastName, home);
  }
  throw new Error("The word lists have no unused names left for a new customer");
}

function makeCustomer(random: SeededRandom, n: number, firstName: string, lastName: string, home: Home): WorldCustomer {
  return {
    key: `cust-${pad(n)}`,
    firstName,
    lastName,
    email: `${firstName}.${lastName}${n}@example.com`.toLowerCase(),
    phone: `555-${random.int(200, 999)}-${random.int(1000, 9999)}`,
    street: `${random.int(100, 9999)} ${random.pick(STREET_NAMES)}`,
    city: home.city,
    state: home.state,
    postalCode: `${home.zipPrefix}${random.int(10, 99)}`,
  };
}

function pad(n: number): string {
  return String(n).padStart(3, "0");
}
