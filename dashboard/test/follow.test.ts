import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { follow, NOT_READ, type Read } from "../lib/follow.ts";

/**
 * A list the twin keeps adding to, `count` items long, as a page reads it. Its positions are "count-history", so a read
 * after a position from another history (a reset, a rewind, a restarted twin) is the twin's 409: "changed".
 */
function twinList(history: string, count: number) {
  const asked: (string | null)[] = [];
  const read = async (after: string | null): Promise<Read<number>> => {
    asked.push(after);
    const [seq, from] = after === null ? [0, history] : [Number(after.split("-")[0]), after.split("-")[1]];
    if (from !== history || seq > count) return "changed";
    return { items: Array.from({ length: count - seq }, (_, i) => seq + i + 1), position: `${count}-${history}` };
  };
  return { asked, read };
}

describe("following a list the twin keeps adding to", () => {
  it("reads all of it the first time, and where the log ends", async () => {
    const twin = twinList("a", 3);
    assert.deepEqual(await follow(NOT_READ, twin.read), { items: [1, 2, 3], position: "3-a" });
    assert.deepEqual(twin.asked, [null]);
  });

  it("then reads only what came since, and adds it to the end", async () => {
    const first = await follow(NOT_READ, twinList("a", 3).read);
    const twin = twinList("a", 5);
    assert.deepEqual(await follow(first, twin.read), { items: [1, 2, 3, 4, 5], position: "5-a" });
    assert.deepEqual(twin.asked, ["3-a"]);
  });

  it("keeps the very same list when nothing is new, so the page doesn't draw it again", async () => {
    const first = await follow(NOT_READ, twinList("a", 3).read);
    assert.equal(await follow(first, twinList("a", 3).read), first);
  });

  it("reads all of it again once the log has changed: a reset, a rewind, or a restarted twin", async () => {
    const first = await follow(NOT_READ, twinList("a", 3).read);
    const twin = twinList("b", 4);
    assert.deepEqual(await follow(first, twin.read), { items: [1, 2, 3, 4], position: "4-b" });
    assert.deepEqual(twin.asked, ["3-a", null]);
  });

  it("reads all of it each time from a twin too old to say where its log ends", async () => {
    const asked: (string | null)[] = [];
    const read = async (after: string | null): Promise<Read<number>> => {
      asked.push(after);
      return { items: [1, 2], position: null };
    };
    assert.deepEqual(await follow(await follow(NOT_READ, read), read), { items: [1, 2], position: null });
    assert.deepEqual(asked, [null, null]);
  });
});
