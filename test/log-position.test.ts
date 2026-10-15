import { describe, expect, it } from "vitest";
import { createCheckpoint, rewindTo } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

/**
 * Following the event log as it grows: every read says where the log ends (X-Twin-Log-Position), and a reader that
 * kept that position asks for only what came after it. A position names a place in one history, so after a reset, a
 * rewind to before it, or in a twin that was started again, the twin says so instead of answering with another
 * history's events.
 */

type App = ReturnType<typeof setup>["app"];

async function readLog(app: App, query = "") {
  const response = await app.request(`/_twin/log.jsonl${query}`);
  const text = await response.text();
  return { status: response.status, position: response.headers.get("X-Twin-Log-Position"), text };
}

const lines = (text: string) => text.split("\n").filter(Boolean);

describe("reading the event log", () => {
  it("says where the log ends: the last event's seq and a fingerprint of everything up to it", async () => {
    const { app, twin } = setup();
    const read = await readLog(app);
    expect(read.position).toMatch(new RegExp(`^${twin.log.length}-[0-9a-f]{16}$`));
    expect((await readLog(app, "?since=")).position).toBe(read.position);
  });

  it("gives the same positions for the same history, and different ones for another", async () => {
    const position = async (seed: number, name: string) => {
      const { app, qboPost } = setup(seed);
      await qboPost("/customer", { DisplayName: name });
      return (await readLog(app)).position;
    };
    expect(await position(42, "Ada Alder")).toBe(await position(42, "Ada Alder"));
    expect(await position(42, "Ada Alder")).not.toBe(await position(42, "Bea Birch"));
    expect(await position(42, "Ada Alder")).not.toBe(await position(43, "Ada Alder"));
  });
});

describe("following the event log", () => {
  it("answers only what was recorded after a position, and where the log ends now", async () => {
    const { app, qboPost } = setup();
    const first = await readLog(app);
    await qboPost("/customer", { DisplayName: "Followed Customer" });

    const next = await readLog(app, `?after=${first.position}`);
    expect(next.status).toBe(200);
    expect(lines(next.text)).toHaveLength(1);
    expect(next.text).toContain("Followed Customer");
    expect(next.position).not.toBe(first.position);

    const nothingNew = await readLog(app, `?after=${next.position}`);
    expect(nothingNew).toEqual({ status: 200, position: next.position, text: "" });
  });

  it("answers 409 once the log is another history: after a reset, a rewind to before the position, or in a new twin", async () => {
    const { app, twin, qboPost } = setup();
    createCheckpoint(twin, "before");
    await qboPost("/customer", { DisplayName: "Rewound Away" });
    const read = await readLog(app);

    rewindTo(twin, "before");
    await qboPost("/customer", { DisplayName: "Made Instead" });
    const afterRewind = await readLog(app, `?after=${read.position}`);
    expect(afterRewind.status).toBe(409);
    expect(JSON.parse(afterRewind.text).error).toContain("Read it again from the start");

    await app.request("/_twin/reset", { method: "POST" });
    expect((await readLog(app, `?after=${read.position}`)).status).toBe(409);

    const restarted = setup();
    await restarted.qboPost("/customer", { DisplayName: "Another Run" });
    expect((await readLog(restarted.app, `?after=${read.position}`)).status).toBe(409);
  });

  it("goes on after a rewind that kept everything up to the position", async () => {
    const { app, twin, qboPost } = setup();
    const read = await readLog(app);
    createCheckpoint(twin, "here");
    await qboPost("/customer", { DisplayName: "Undone" });
    rewindTo(twin, "here");
    await qboPost("/customer", { DisplayName: "Done Instead" });

    const next = await readLog(app, `?after=${read.position}`);
    expect(next.status).toBe(200);
    expect(lines(next.text)).toHaveLength(1);
    expect(next.text).toContain("Done Instead");
  });

  it("takes an event's seq instead, on trust, but not one past the end of the log", async () => {
    const { app, twin } = setup();
    const lastTwo = await readLog(app, `?after=${twin.log.length - 2}`);
    expect(lines(lastTwo.text).map((line) => JSON.parse(line).seq)).toEqual([twin.log.length - 1, twin.log.length]);
    expect((await readLog(app, `?after=${twin.log.length + 1}`)).status).toBe(409);
    expect((await readLog(app, "?after=0")).text).toBe((await readLog(app, "?after=")).text);
    expect(lines((await readLog(app, "?after=")).text)).toHaveLength(twin.log.length);
  });

  it("says what after takes, and that since and after don't go together", async () => {
    const { app } = setup();
    const unreadable = await readLog(app, "?after=latest");
    expect(unreadable.status).toBe(400);
    expect(JSON.parse(unreadable.text).error).toContain("X-Twin-Log-Position");

    await app.request("/_twin/checkpoints/mark", { method: "POST" });
    const both = await readLog(app, "?since=mark&after=1");
    expect(both.status).toBe(400);
    expect(JSON.parse(both.text).error).toBe("Give since (a checkpoint) or after (a position), not both.");
  });
});

describe("following the changes since a checkpoint", () => {
  async function readChanges(app: App, query: string) {
    const response = await app.request(`/_twin/checkpoints/before/changes${query}`);
    const body = await response.json();
    return { status: response.status, position: response.headers.get("X-Twin-Log-Position"), body };
  }

  it("answers only the changes after a position, from the source asked for, and where the log ends now", async () => {
    const { app, qboPost } = setup();
    await app.request("/_twin/checkpoints/before", { method: "POST" });
    await qboPost("/customer", { DisplayName: "First Change" });
    const first = await readChanges(app, "?source=api");
    expect(first.position).toBe((await readLog(app)).position);

    await qboPost("/customer", { DisplayName: "Second Change" });
    await app.request("/_twin/actions/jobber/newClients", { method: "POST", body: "1" });
    const next = await readChanges(app, `?source=api&after=${first.position}`);
    expect(next.body.map((change: { summary: string }) => change.summary)).toEqual([expect.stringContaining("Second Change")]);
    expect(next.position).toBe((await readLog(app)).position);
  });

  it("answers 409 once the log is another history, as a read of the log does", async () => {
    const { app, qboPost } = setup();
    await app.request("/_twin/checkpoints/before", { method: "POST" });
    await qboPost("/customer", { DisplayName: "Rewound Away" });
    const read = await readChanges(app, "");
    await app.request("/_twin/checkpoints/before/rewind", { method: "POST" });
    const afterRewind = await readChanges(app, `?after=${read.position}`);
    expect(afterRewind.status).toBe(409);
    expect(afterRewind.body.error).toContain("Read it again from the start");
  });
});
