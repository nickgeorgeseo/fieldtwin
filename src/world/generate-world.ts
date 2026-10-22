import type { SeededRandom } from "../core/random.ts";
import { type CatalogEntry, makeCatalog } from "./catalog.ts";
import { type DriftOptions, makeDrift, type WorldDrift } from "./drift.ts";
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
  company: WorldCompany;
  customers: WorldCustomer[];
  technicians: WorldTechnician[];
  catalog: CatalogEntry[];
  history: WorldHistory;
  drift: WorldDrift; // how far the field-service and accounting systems disagree (nothing, by default)
}

export interface WorldCompany {
  name: string;
  trade: string;
  city: string;
  state: string;
  utcOffsetHours: number;
  street: string; // the business's own address and phone, for vendors that show them (Housecall Pro's GET /company)
  postalCode: string;
  phone: string;
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
  email: string; // every vendor gives the tech this address, so their records can be matched across systems
}

export interface WorldSize {
  customers: number;
  technicians: number;
}

const DEFAULT_SIZE: WorldSize = { customers: 25, technicians: 4 };

export interface WorldOptions {
  startTime: string; // history is laid out around this moment: the past behind it, the schedule ahead
  size?: Partial<WorldSize>;
  drift?: DriftOptions;
}

export function generateWorld(random: SeededRandom, options: WorldOptions): World {
  const { customers, technicians } = { ...DEFAULT_SIZE, ...options.size };
  const home = random.pick(CITIES);
  const trade = random.pick(TRADES);
  const ownerLastName = random.pick(LAST_NAMES);

  // Order matters: each part draws from the same random stream, so new parts of the world go last.
  // That way an existing seed keeps the same company, customers, and technicians when the world grows.
  const identity = {
    name: `${ownerLastName} ${trade.businessSuffix}`,
    trade: trade.name,
    city: home.city,
    state: home.state,
    utcOffsetHours: home.utcOffsetHours,
  };
  const customerList = makeCustomers(random, customers, home);
  const technicianList = Array.from({ length: technicians }, (_, i): WorldTechnician => {
    const [firstName, lastName] = [random.pick(FIRST_NAMES), random.pick(LAST_NAMES)];
    return { key: `tech-${pad(i + 1)}`, firstName, lastName, email: `${firstName}.${lastName}.${i + 1}@example.com`.toLowerCase() };
  });
  const catalog = makeCatalog(random, trade.name);
  const drift = makeDrift(customerList, options.drift);
  const history = makeHistory({
    random,
    // Customers who exist only in the books have never had field work.
    customers: customerList.filter((customer) => !drift.accountingOnly.includes(customer.key)),
    technicians: technicianList,
    catalog,
    startMs: Date.parse(options.startTime),
    utcOffsetHours: home.utcOffsetHours,
    needsWork: drift.fieldServiceOnly,
    needsRecentPaidWork: drift.inactiveInAccounting,
  });
  // Drawn last of all, after the history, so adding them changed nothing an existing seed already made.
  const office = {
    street: `${random.int(100, 9999)} ${random.pick(STREET_NAMES)}`,
    postalCode: `${home.zipPrefix}${random.int(10, 99)}`,
    phone: `555-${random.int(200, 999)}-${random.int(1000, 9999)}`,
  };

  const company = { ...identity, ...office };
  return { asOf: options.startTime, company, customers: customerList, technicians: technicianList, catalog, history, drift };
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
 * The most new customers one scenario action brings in. A count past this is a typo: no scenario needs a thousand
 * people to call in at once, and making them would take seconds and bloat the log with records nobody reads.
 */
export const MOST_NEW_CUSTOMERS = 1000;

/**
 * `count` people new to the business, for scenario timelines ("15 new clients by 9 a.m."), numbered from
 * `firstNumber` so their emails are unique. Nobody shares a name with the vendor's own customers (`takenNames`,
 * "First Last"), with anyone else the world has, customers only the books know included, or with each other.
 */
export function newCustomers(
  random: SeededRandom,
  world: World,
  { firstNumber, count }: { firstNumber: number; count: number },
  takenNames: Iterable<string>,
) {
  const taken = new Set(takenNames);
  for (const person of world.customers) taken.add(`${person.firstName} ${person.lastName}`);
  return Array.from({ length: count }, (_, index) => {
    const person = newCustomer(random, world, firstNumber + index, taken);
    taken.add(`${person.firstName} ${person.lastName}`);
    return person;
  });
}

/**
 * Someone new to the business: local to the world's city, with a name nobody in `takenNames` has, numbered `n`.
 * Once the word lists' names are all taken, newcomers get a middle initial ("Avery J. Brooks"), so a timeline
 * that runs for weeks of twin time never fails for want of a name.
 */
function newCustomer(random: SeededRandom, world: World, n: number, takenNames: Set<string>): WorldCustomer {
  const home = CITIES.find((city) => city.city === world.company.city)!;
  for (let attempt = 0; attempt < 50; attempt++) {
    const firstName = random.pick(FIRST_NAMES);
    const lastName = random.pick(LAST_NAMES);
    if (!takenNames.has(`${firstName} ${lastName}`)) return makeCustomer(random, n, firstName, lastName, home);
  }
  // The names left are few: look through them in order, from a random place, before adding initials.
  const start = random.int(0, FIRST_NAMES.length * LAST_NAMES.length - 1);
  for (const initial of ["", ..."ABCDEFGHJKLMNPRSTW"]) {
    for (let offset = 0; offset < FIRST_NAMES.length * LAST_NAMES.length; offset++) {
      const index = (start + offset) % (FIRST_NAMES.length * LAST_NAMES.length);
      const firstName = `${FIRST_NAMES[index % FIRST_NAMES.length]}${initial && ` ${initial}.`}`;
      const lastName = LAST_NAMES[Math.floor(index / FIRST_NAMES.length)]!;
      if (!takenNames.has(`${firstName} ${lastName}`)) return makeCustomer(random, n, firstName, lastName, home);
    }
  }
  throw new Error(`Every name the twin can make is taken (${takenNames.size} people)`);
}

function makeCustomer(random: SeededRandom, n: number, firstName: string, lastName: string, home: Home): WorldCustomer {
  return {
    key: `cust-${pad(n)}`,
    firstName,
    lastName,
    email: `${emailPart(firstName)}.${emailPart(lastName)}${n}@example.com`,
    phone: `555-${random.int(200, 999)}-${random.int(1000, 9999)}`,
    street: `${random.int(100, 9999)} ${random.pick(STREET_NAMES)}`,
    city: home.city,
    state: home.state,
    postalCode: `${home.zipPrefix}${random.int(10, 99)}`,
  };
}

/** A name as the local part of an email address: "Avery J." is "averyj". */
function emailPart(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pad(n: number): string {
  return String(n).padStart(3, "0");
}
