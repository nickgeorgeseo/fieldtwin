import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** Job, Visit, User: https://developer.getjobber.com/docs (Important Objects) */

type Harness = ReturnType<typeof setup>;
const data = async (harness: Harness, query: string, variables?: Record<string, unknown>) => {
  const body = await (await harness.jobber(query, variables)).json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
};
const totalOf = (lines: { quantity: number; unitPrice: number }[]) =>
  Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;

describe("Jobber twin: jobs", () => {
  it("lists the business's jobs in number order, each with its client and total", async () => {
    const harness = setup();
    const { jobs } = await data(harness, "{ jobs(first: 100) { totalCount nodes { jobNumber title total client { name } } } }");
    const history = harness.twin.world.history.jobs;
    expect(jobs.totalCount).toBe(history.length);
    expect(jobs.nodes.map((job: { jobNumber: number }) => job.jobNumber)).toEqual(history.map((job) => job.number));

    const [first] = jobs.nodes;
    const worldJob = history[0]!;
    const customer = harness.twin.world.customers.find((candidate) => candidate.key === worldJob.customerKey)!;
    expect(first).toEqual({
      jobNumber: 1,
      title: worldJob.title,
      total: totalOf(worldJob.lineItems),
      client: { name: `${customer.firstName} ${customer.lastName}` },
    });
  });

  it("finds a job by id with its line items, visits, and assigned technicians", async () => {
    const harness = setup();
    const { jobs } = await data(harness, "{ jobs(first: 1) { nodes { id } } }");
    const { job } = await data(
      harness,
      `query ($id: EncodedId!) { job(id: $id) {
        jobNumber startAt endAt completedAt
        lineItems(first: 5) { nodes { name description quantity unitPrice totalPrice } }
        visits(first: 5) { totalCount nodes { title startAt endAt isComplete visitStatus job { jobNumber } assignedUsers(first: 3) { nodes { name { full } } } } }
      } }`,
      { id: jobs.nodes[0].id },
    );
    const worldJob = harness.twin.world.history.jobs[0]!;
    expect(job.lineItems.nodes[0]).toEqual({
      name: worldJob.lineItems[0]!.name,
      description: worldJob.lineItems[0]!.description,
      quantity: worldJob.lineItems[0]!.quantity,
      unitPrice: worldJob.lineItems[0]!.unitPrice,
      totalPrice: totalOf([worldJob.lineItems[0]!]),
    });
    expect(job.visits.totalCount).toBe(worldJob.visits.length);
    expect(job.startAt).toBe(worldJob.visits[0]!.startAt);
    expect(job.completedAt).toBe(worldJob.visits.at(-1)!.completedAt);

    const technicianNames = harness.twin.world.technicians.map((tech) => `${tech.firstName} ${tech.lastName}`);
    for (const visit of job.visits.nodes) {
      expect(visit).toMatchObject({ title: worldJob.title, isComplete: true, visitStatus: "completed", job: { jobNumber: 1 } });
      for (const user of visit.assignedUsers.nodes) expect(technicianNames).toContain(user.name.full);
    }
  });

  it("answers null for a job id that matches nothing", async () => {
    const harness = setup();
    const missing = Buffer.from("gid://Jobber/Job/99999").toString("base64");
    expect(await data(harness, "query ($id: EncodedId!) { job(id: $id) { id } }", { id: missing })).toEqual({ job: null });
  });

  it("lists a client's own jobs", async () => {
    const harness = setup();
    const worldJob = harness.twin.world.history.jobs[0]!;
    const customerIndex = harness.twin.world.customers.findIndex((customer) => customer.key === worldJob.customerKey);
    const clientId = Buffer.from(`gid://Jobber/Client/${customerIndex + 1}`).toString("base64");
    const { client } = await data(harness, "query ($id: EncodedId!) { client(id: $id) { jobs(first: 20) { nodes { jobNumber } } } }", {
      id: clientId,
    });
    const expected = harness.twin.world.history.jobs.filter((job) => job.customerKey === worldJob.customerKey).map((job) => job.number);
    expect(client.jobs.nodes.map((job: { jobNumber: number }) => job.jobNumber)).toEqual(expected);
  });
});

describe("Jobber twin: visits and statuses on twin time", () => {
  it("prices nested lists per node, so asking for every visit of every job gets throttled", async () => {
    const body = await (await setup().jobber("{ jobs { nodes { visits { nodes { id startAt visitStatus } } } } }")).json();
    expect(body.extensions.cost.requestedQueryCost).toBe(100 * 100 * 3);
    expect(body.errors[0].extensions.code).toBe("THROTTLED");
  });

  // Nested connections are priced per node, so ask for small pages the way Jobber's docs recommend.
  const VISITS = "{ jobs(first: 60) { nodes { jobStatus visits(first: 3) { nodes { id startAt visitStatus } } } } }";

  it("shows finished work, today's board, and the schedule ahead", async () => {
    const { jobs } = await data(setup(), VISITS);
    const statuses = jobs.nodes.flatMap((job: { visits: { nodes: { visitStatus: string }[] } }) =>
      job.visits.nodes.map((v) => v.visitStatus),
    );
    expect(new Set(statuses)).toEqual(new Set(["completed", "today", "upcoming"]));
    const jobStatuses = new Set(jobs.nodes.map((job: { jobStatus: string }) => job.jobStatus));
    expect(jobStatuses).toContain("today");
    expect(jobStatuses).toContain("upcoming");
  });

  it("moves a visit from upcoming to today to late as twin time passes, with no events recorded", async () => {
    const harness = setup();
    const before = harness.twin.log.length;
    const { jobs } = await data(harness, VISITS);
    const upcoming = jobs.nodes
      .flatMap((job: { visits: { nodes: { id: string; startAt: string; visitStatus: string }[] } }) => job.visits.nodes)
      .find((visit: { visitStatus: string }) => visit.visitStatus === "upcoming");
    const status = async () =>
      (await data(harness, `{ jobs(first: 60) { nodes { visits(first: 3) { nodes { id visitStatus } } } } }`)).jobs.nodes
        .flatMap((job: { visits: { nodes: { id: string; visitStatus: string }[] } }) => job.visits.nodes)
        .find((visit: { id: string }) => visit.id === upcoming.id).visitStatus;

    // Move to the morning of the visit's day, in the business's time zone: it's on today's board, and stays
    // there while it's running. Once its day is over without the visit being completed, it's late.
    const offsetMs = harness.twin.world.company.utcOffsetHours * 3_600_000;
    const localMidnight =
      Date.parse(`${new Date(Date.parse(upcoming.startAt) + offsetMs).toISOString().slice(0, 10)}T00:00:00Z`) - offsetMs;
    harness.twin.clock.advance(localMidnight + 3_600_000 - harness.twin.clock.nowMs());
    expect(await status()).toBe("today");
    harness.twin.clock.advance(Date.parse(upcoming.startAt) + 60_000 - harness.twin.clock.nowMs());
    expect(await status()).toBe("today");
    harness.twin.clock.advance(localMidnight + 24 * 3_600_000 + 60_000 - harness.twin.clock.nowMs());
    expect(await status()).toBe("late");
    expect(harness.twin.log.length).toBe(before);
  });
});

describe("Jobber twin: users", () => {
  it("lists the business's technicians as users", async () => {
    const harness = setup();
    const { users } = await data(harness, "{ users { totalCount nodes { id name { first last full } email { raw } isAccountOwner } } }");
    expect(users.totalCount).toBe(harness.twin.world.technicians.length);
    const tech = harness.twin.world.technicians[0]!;
    expect(users.nodes[0]).toMatchObject({
      name: { first: tech.firstName, last: tech.lastName, full: `${tech.firstName} ${tech.lastName}` },
      isAccountOwner: false,
    });
    expect(users.nodes[0].email.raw).toBe(tech.email);
  });
});
