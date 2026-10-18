import { type Answer, expectOk, housecallpro, type Observation, type Observations, type Target, unique } from "../case.ts";

/**
 * What the Housecall Pro cases share: how they boil answers down to observations, and the records they make. A twin
 * and a real account hold different records, with different ids, names, and times, so cases keep only what can't
 * differ: statuses, the shape of a body, and yes-or-no facts.
 */

/** A body's shape without its values: each key, in order, with the kind of value it holds ("string", a list, ...). */
export function shapeOf(value: unknown, depth = 0): Observation {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length && depth < 4 ? [shapeOf(value[0], depth + 1)] : [];
  if (typeof value !== "object") return typeof value;
  if (depth >= 4) return "object";
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, shapeOf(record[key], depth + 1)]),
  );
}

/**
 * How a request went: its status and, for an error, the shape of its body, which is what clients read to say why.
 * Never under the key "error": that is how a run marks a case that couldn't finish (run.ts).
 */
export function errorOf(answer: Answer): Observations {
  return answer.status < 300 ? { status: answer.status } : { status: answer.status, body: shapeOf(answer.body) };
}

/**
 * The id of the first record in a list ("customers", "jobs"), to model an unknown one on. An id in a form the account
 * doesn't use, with another prefix or none, might be refused as malformed: a question other than whether it exists.
 */
export async function firstId(target: Target, list: string): Promise<string> {
  const id: unknown = expectOk(await housecallpro(target, "GET", `/${list}?page_size=1`), `list ${list}`)?.[list]?.[0]?.id;
  if (typeof id === "string") return id;
  throw new Error(
    `The account has no ${list}, so this case can't tell: it makes an unknown id in the form of one. Make one in Housecall Pro first.`,
  );
}

/** An id in the form of `id` that no record has: every hex digit after its prefix ("cus_") made 0. */
export function noneLike(id: string): string {
  const start = id.lastIndexOf("_") + 1;
  return id.slice(0, start) + id.slice(start).replace(/[0-9a-f]/gi, "0");
}

/** An address with every field AddressCreate requires, for the customers the cases make. Nobody lives there. */
export const ADDRESS = { street: "1 Conformance Way", city: "Springfield", state: "IL", zip: "62701", country: "US" };

/**
 * A new customer with `fields`, named "fieldtwin conformance ..." so they are easy to find in Housecall Pro, whose API
 * can't delete them. Notifications are off unless `fields` say otherwise, and a case gives them no way to be reached.
 */
export async function newCustomer(target: Target, label: string, fields: object = {}): Promise<Answer["body"]> {
  const customer = { last_name: unique(label), notifications_enabled: false, ...fields };
  return expectOk(await housecallpro(target, "POST", "/customers", customer), "create a customer");
}

/**
 * Whether `found()` comes true, asking again for ten seconds on a real account, where a new record can take a moment to
 * show in searches and lists. A twin shows it at once.
 */
export async function eventually(target: Target, found: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    if (await found()) return true;
    if (!target.pause || attempt === 6) return false;
    await target.pause(2000);
  }
}

/** Lets a second pass before the next write, so the two get different times: a twin's clock moves when asked the time. */
export async function aSecondLater(target: Target): Promise<void> {
  await target.now();
  await target.pause?.(1100);
}

interface JobsCustomer {
  id: string;
  addressId: string;
}
const jobsCustomers = new WeakMap<Target, Promise<JobsCustomer>>();

/**
 * The customer every job the cases make is for, with an address and notes, made the first time a case asks: one per
 * run, since Housecall Pro's API can delete neither jobs nor customers.
 */
export function jobsCustomer(target: Target): Promise<JobsCustomer> {
  let made = jobsCustomers.get(target);
  if (!made) {
    made = newCustomer(target, "jobs", { notes: "fieldtwin conformance notes", addresses: [ADDRESS] }).then((customer) => {
      const addressId = customer.addresses?.[0]?.id;
      if (typeof addressId !== "string")
        throw new Error("The new customer came back without the address sent with them, so no job can be made.");
      return { id: customer.id, addressId };
    });
    jobsCustomers.set(target, made);
  }
  return made;
}

/** A new job for the jobs customer, at their address, with `fields` from JobCreate. */
export async function newJob(target: Target, fields: object = {}): Promise<Answer["body"]> {
  const { id, addressId } = await jobsCustomer(target);
  return expectOk(await housecallpro(target, "POST", "/jobs", { customer_id: id, address_id: addressId, ...fields }), "create a job");
}

/** Whether the jobs customer's jobs, filtered by `query`, include the job with `id`. */
export async function customersJobsInclude(target: Target, id: string, query = ""): Promise<boolean> {
  const customer = await jobsCustomer(target);
  const answer = expectOk(await housecallpro(target, "GET", `/jobs?customer_id=${customer.id}&page_size=100${query}`), "list jobs");
  return (answer.jobs ?? []).some((job: { id: string }) => job.id === id);
}
