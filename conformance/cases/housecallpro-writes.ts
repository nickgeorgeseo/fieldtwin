import { randomInt, randomUUID } from "node:crypto";
import { type ConformanceCase, expectOk, housecallpro, unique } from "../case.ts";
import { ADDRESS, aSecondLater, errorOf, eventually, newCustomer, shapeOf } from "./housecallpro-shared.ts";

/**
 * Housecall Pro cases that make customers, named "fieldtwin conformance ...". Housecall Pro's API can't delete
 * customers, so they stay in the account. None can be reached: their phone numbers are ones set aside for fiction,
 * and their email addresses are at example.com. They run after the cases that only read.
 */
export const housecallproWriteCases: ConformanceCase[] = [
  {
    name: "customer-without-a-name",
    vendor: "housecallpro",
    endpoint: "POST /customers",
    fidelity: "POST /customers",
    // "One of first_name, last_name, email, mobile_number, home_number, work_number are required": made only if not.
    // https://docs.housecallpro.com/docs/housecall-public-api/4e0bf8c4d65d7-create-customer
    writes: true,
    observe: async (target) =>
      errorOf(await housecallpro(target, "POST", "/customers", { company: unique("no name"), notifications_enabled: false })),
  },
  {
    name: "customer-field-types",
    vendor: "housecallpro",
    endpoint: "POST /customers",
    fidelity: "Customer field types",
    writes: true,
    async observe(target) {
      // Values of the wrong kind, which Housecall Pro might take as they are, convert, or refuse, as the twin does.
      const create = (fields: object) =>
        housecallpro(target, "POST", "/customers", { last_name: unique("field types"), notifications_enabled: false, ...fields });
      const numberAsName = await create({ first_name: 1234 });
      const textAsBoolean = await create({ notifications_enabled: "false" });
      return {
        numberAsName: { ...errorOf(numberAsName), ...(numberAsName.status < 300 && { firstName: shapeOf(numberAsName.body?.first_name) }) },
        textAsBoolean: {
          ...errorOf(textAsBoolean),
          ...(textAsBoolean.status < 300 && { notificationsEnabled: textAsBoolean.body?.notifications_enabled ?? null }),
        },
      };
    },
  },
  {
    name: "new-customer-defaults",
    vendor: "housecallpro",
    endpoint: "POST /customers",
    fidelity: "Defaults for a new customer",
    writes: true,
    async observe(target) {
      // Nothing about notifications or tags, and an address with no type, so the answer shows what they default to.
      const mobile = "(201) 555-0123"; // 555-0100 to 555-0199 are set aside for fiction: nobody has the number
      const body = { last_name: unique("defaults"), mobile_number: mobile, addresses: [ADDRESS] };
      const customer = expectOk(await housecallpro(target, "POST", "/customers", body), "create a customer");
      const kept = String(customer.mobile_number ?? "");
      return {
        notificationsEnabled: customer.notifications_enabled ?? null,
        tags: shapeOf(customer.tags),
        addressType: customer.addresses?.[0]?.type ?? null,
        mobileNumber: kept === mobile ? "as sent" : kept.replace(/\D/g, "").endsWith("2015550123") ? "rewritten" : "other",
      };
    },
  },
  {
    name: "put-semantics",
    vendor: "housecallpro",
    endpoint: "PUT /customers/{id}",
    fidelity: "PUT /customers/{id}",
    writes: true,
    async observe(target) {
      const created = await newCustomer(target, "put", { first_name: "Kept", company: "Before", notes: "Kept" });
      const put = async (fields: object) =>
        expectOk(await housecallpro(target, "PUT", `/customers/${created.id}`, fields), "update the customer");
      const changed = await put({ company: "After" });
      const cleared = await put({ company: null });
      await aSecondLater(target);
      const unchanged = await put({ company: null }); // what it is already
      return {
        changesWhatItSends: changed.company === "After",
        keepsWhatItDoesnt: changed.first_name === "Kept" && changed.last_name === created.last_name && changed.notes === "Kept",
        nullClears: cleared.company === null,
        unchangedKeepsUpdatedAt: unchanged.updated_at === cleared.updated_at,
      };
    },
  },
  {
    name: "address-without-street",
    vendor: "housecallpro",
    endpoint: "POST /customers/{id}/addresses",
    fidelity: "A customer's addresses",
    writes: true,
    async observe(target) {
      const customer = await newCustomer(target, "addresses");
      const { street: _, ...withoutStreet } = ADDRESS;
      const refused = await housecallpro(target, "POST", `/customers/${customer.id}/addresses`, withoutStreet);
      // The list's answer isn't documented: its top-level keys say how it pages, whatever addresses there are.
      const list = await housecallpro(target, "GET", `/customers/${customer.id}/addresses`);
      const listed = list.status >= 300 ? errorOf(list) : Array.isArray(list.body) ? "a list" : Object.keys(list.body ?? {}).sort();
      return { withoutStreet: errorOf(refused), list: listed };
    },
  },
  {
    name: "customer-search",
    vendor: "housecallpro",
    endpoint: "GET /customers",
    fidelity: "Customer search (q)",
    writes: true,
    async observe(target) {
      // q searches "by name, email, mobile number and address": a word of each its own, so each match says what matched.
      const hex = randomUUID().slice(0, 8);
      const [name, mail, street, line] = [`name${hex}`, `mail${hex}`, `street${hex}`, `01${String(randomInt(100)).padStart(2, "0")}`];
      const customer = await newCustomer(target, "search", {
        first_name: "fieldtwin",
        last_name: `conformance ${name}`,
        email: `${mail}@example.com`,
        mobile_number: `(201) 555-${line}`,
        addresses: [{ ...ADDRESS, street: `1 ${street} Way` }],
      });
      const finds = async (q: string) => {
        const answer = expectOk(
          await housecallpro(target, "GET", `/customers?page_size=50&q=${encodeURIComponent(q)}`),
          "search customers",
        );
        return (answer.customers ?? []).some((found: { id: string }) => found.id === customer.id);
      };
      // A new customer may take a moment to be searchable: until their name finds them, nothing else would mean anything.
      if (!(await eventually(target, () => finds(name)))) {
        throw new Error(
          "The new customer never showed up in a search for their name, so this case can't tell how q matches. Try again later.",
        );
      }
      return {
        nameInCapitals: await finds(name.toUpperCase()),
        middleOfName: await finds(name.slice(2, -2)),
        email: await finds(`${mail}@example.com`),
        street: await finds(street),
        mobileDigits: await finds(`201555${line}`),
        lastDigitsOfMobile: await finds(`555${line}`),
        mobileWrittenAnotherWay: await finds(`201-555-${line}`),
      };
    },
  },
  {
    name: "customer-sort-order",
    vendor: "housecallpro",
    endpoint: "GET /customers",
    fidelity: "Sorting lists",
    writes: true,
    async observe(target) {
      // Customers made a second apart: two whose last names sort one way ignoring case ("a" before "B") and the other by
      // character code, then one with no last name. They are told apart by id, whatever names come back.
      const word = `sort${randomUUID().slice(0, 8)}`;
      const made = new Map<string, string>();
      for (const [label, fields] of [
        ["a", { last_name: `conformance ${word} a` }],
        ["B", { last_name: `conformance ${word} B` }],
        ["no last name", { first_name: `fieldtwin conformance ${word}`, last_name: null }],
      ] as const) {
        made.set((await newCustomer(target, "sort", { first_name: "fieldtwin", ...fields })).id, label);
        await aSecondLater(target);
      }
      const order = async (sort: string): Promise<string[]> => {
        const answer = expectOk(await housecallpro(target, "GET", `/customers?page_size=50&q=${word}${sort}`), "list customers");
        return (answer.customers ?? []).flatMap((customer: { id: string }) => made.get(customer.id) ?? []);
      };
      if (!(await eventually(target, async () => (await order("")).length === made.size))) {
        throw new Error("The new customers never all showed up in a search, so this case can't tell how they sort. Try again later.");
      }
      return { byLastNameAscending: await order("&sort_by=last_name&sort_direction=asc"), byDefault: await order("") };
    },
  },
];
