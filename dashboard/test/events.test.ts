import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeEvent, filterEvents, followLog, type LogReader, NOT_READ, parseLog } from "../lib/events.ts";
import type { TwinEvent } from "../lib/twin-types.ts";

function event(seq: number, vendor: string, type: string, data: unknown, source = "api"): TwinEvent {
  return { seq, vendor, type, data, source, at: "2026-07-13T11:00:00.000Z" };
}

describe("reading the event log", () => {
  it("reads one event per line and skips blank lines", () => {
    const events = parseLog('{"seq":1,"vendor":"jobber","type":"AccountCreated","data":{},"at":"x","source":"seed"}\n\n{"seq":2}\n');
    assert.deepEqual(
      events.map((read) => read.seq),
      [1, 2],
    );
    assert.deepEqual(parseLog(""), []);
  });
});

describe("following the event log", () => {
  const line = (seq: number) => JSON.stringify(event(seq, "jobber", "ClientCreated", { client: { id: String(seq) } }));

  /**
   * A twin's log of `count` events, as the dashboard reads it. Its positions are "count-history", so a read after a
   * position from another history (a reset, a rewind, a restarted twin) is a 409, "changed", as the twin answers it.
   */
  function twinLog(history: string, count: number) {
    const asked: (string | null)[] = [];
    const read: LogReader = async (after) => {
      asked.push(after);
      const [seq, from] = after === null ? [0, history] : [Number(after.split("-")[0]), after.split("-")[1]];
      if (from !== history || seq > count) return "changed";
      const text = Array.from({ length: count - seq }, (_, i) => line(seq + i + 1)).join("\n");
      return { text, position: `${count}-${history}` };
    };
    return { asked, read };
  }
  const seqs = (events: TwinEvent[]) => events.map((read) => read.seq);

  it("reads the whole log the first time, and where it ends", async () => {
    const twin = twinLog("a", 3);
    const log = await followLog(NOT_READ, twin.read);
    assert.deepEqual(seqs(log.events), [1, 2, 3]);
    assert.equal(log.position, "3-a");
    assert.deepEqual(twin.asked, [null]);
  });

  it("then reads only what was recorded since, and adds it to the end", async () => {
    const first = await followLog(NOT_READ, twinLog("a", 3).read);
    const twin = twinLog("a", 5);
    const log = await followLog(first, twin.read);
    assert.deepEqual(seqs(log.events), [1, 2, 3, 4, 5]);
    assert.equal(log.position, "5-a");
    assert.deepEqual(twin.asked, ["3-a"]);
  });

  it("keeps the very same log when nothing new was recorded, so the page doesn't draw it again", async () => {
    const first = await followLog(NOT_READ, twinLog("a", 3).read);
    assert.equal(await followLog(first, twinLog("a", 3).read), first);
  });

  it("reads the whole log again once it has changed: a reset, a rewind, or a restarted twin", async () => {
    const first = await followLog(NOT_READ, twinLog("a", 3).read);
    const twin = twinLog("b", 4);
    const log = await followLog(first, twin.read);
    assert.deepEqual(seqs(log.events), [1, 2, 3, 4]);
    assert.equal(log.position, "4-b");
    assert.deepEqual(twin.asked, ["3-a", null]);
  });

  it("reads the whole log each time from a twin too old to say where its log ends", async () => {
    const asked: (string | null)[] = [];
    const read: LogReader = async (after) => {
      asked.push(after);
      return { text: [1, 2].map(line).join("\n"), position: null };
    };
    const log = await followLog(await followLog(NOT_READ, read), read);
    assert.deepEqual(seqs(log.events), [1, 2]);
    assert.deepEqual(asked, [null, null]);
  });
});

describe("saying what an event is about", () => {
  it("names a QuickBooks customer by its display name and Id", () => {
    assert.equal(
      describeEvent(event(1, "quickbooks", "CustomerCreated", { customer: { Id: "26", DisplayName: "Dana Whitfield" } })),
      'Id=26 "Dana Whitfield"',
    );
  });

  it("names a Jobber client by first and last name, or by company", () => {
    assert.equal(
      describeEvent(event(1, "jobber", "ClientCreated", { client: { id: "Z2lk", firstName: "Kendall", lastName: "Dunmore" } })),
      '"Kendall Dunmore"',
    );
    assert.equal(
      describeEvent(event(1, "jobber", "ClientCreated", { client: { firstName: null, lastName: null, companyName: "Acme" } })),
      '"Acme"',
    );
  });

  it("names a Jobber account by its name, and a team member by their full name", () => {
    assert.equal(
      describeEvent(event(1, "jobber", "AccountCreated", { account: { id: "Z2lk", name: "Thorne Heating & Air" } })),
      '"Thorne Heating & Air"',
    );
    assert.equal(
      describeEvent(
        event(1, "jobber", "UserCreated", { user: { name: { first: "Jordan", last: "Kettering", full: "Jordan Kettering" } } }),
      ),
      '"Jordan Kettering"',
    );
  });

  it("numbers invoices, jobs, and quotes the way each vendor does", () => {
    assert.equal(
      describeEvent(event(1, "jobber", "InvoiceUpdated", { invoice: { invoiceNumber: "13", subject: "AC tune-up" } })),
      '#13 "AC tune-up"',
    );
    assert.equal(describeEvent(event(1, "jobber", "JobCreated", { job: { jobNumber: 4, title: "Panel upgrade" } })), '#4 "Panel upgrade"');
    assert.equal(
      describeEvent(
        event(1, "quickbooks", "InvoiceCreated", {
          invoice: { Id: "29", DocNumber: "1001", CustomerRef: { name: "Dana Whitfield" }, TotalAmt: 185 },
        }),
      ),
      'Id=29 DocNumber=1001 "Dana Whitfield" 185.00',
    );
  });

  it("says who paid and how much for a payment", () => {
    assert.equal(
      describeEvent(
        event(1, "quickbooks", "PaymentCreated", { payment: { Id: "19", CustomerRef: { name: "Riley Northcott" }, TotalAmt: 955 } }),
      ),
      'Id=19 "Riley Northcott" 955.00',
    );
  });

  it("says nothing it can't back up when the record is unfamiliar", () => {
    assert.equal(describeEvent(event(1, "quickbooks", "CompanyCreated", { realmId: "9341000000000001" })), "");
  });
});

describe("filtering the feed", () => {
  const events = [
    event(1, "quickbooks", "CustomerCreated", { customer: { Id: "1", DisplayName: "Kendall Dunmore" } }, "seed"),
    event(2, "jobber", "ClientCreated", { client: { firstName: "Quinn", lastName: "Brooks" } }, "scenario"),
    event(3, "quickbooks", "CustomerUpdated", { customer: { Id: "3", DisplayName: "Harper Alder Jr" } }, "api"),
  ];

  it("keeps the vendors and sources asked for", () => {
    assert.deepEqual(
      filterEvents(events, { vendor: "quickbooks", sources: ["api", "seed"], search: "" }).map((kept) => kept.seq),
      [1, 3],
    );
    assert.deepEqual(
      filterEvents(events, { vendor: "", sources: ["scenario"], search: "" }).map((kept) => kept.seq),
      [2],
    );
  });

  it("finds a search anywhere in the event, ignoring case", () => {
    assert.deepEqual(
      filterEvents(events, { vendor: "", sources: ["seed", "scenario", "api"], search: "brooks" }).map((kept) => kept.seq),
      [2],
    );
    assert.deepEqual(
      filterEvents(events, { vendor: "", sources: ["seed", "scenario", "api"], search: "customerupdated" }).map((kept) => kept.seq),
      [3],
    );
  });
});
