import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTwinTime, minutesLabel } from "../lib/twin-time.ts";

describe("showing twin time", () => {
  it("shows it in the company's own time zone", () => {
    assert.deepEqual(formatTwinTime("2026-07-13T11:00:00.000Z", -5), { day: "Mon, Jul 13, 2026", time: "6:00 AM", zone: "UTC−5" });
  });

  it("moves to the right day when the offset crosses midnight", () => {
    assert.deepEqual(formatTwinTime("2026-07-14T02:30:00.000Z", -5), { day: "Mon, Jul 13, 2026", time: "9:30 PM", zone: "UTC−5" });
  });

  it("names a zone east of UTC, or UTC itself", () => {
    assert.equal(formatTwinTime("2026-07-13T11:00:00.000Z", 10).zone, "UTC+10");
    assert.equal(formatTwinTime("2026-07-13T11:00:00.000Z", 0).zone, "UTC");
  });

  it("says how long a jump is in the units people use", () => {
    assert.equal(minutesLabel(15), "15 minutes");
    assert.equal(minutesLabel(60), "1 hour");
    assert.equal(minutesLabel(360), "6 hours");
    assert.equal(minutesLabel(1440), "1 day");
    assert.equal(minutesLabel(90), "90 minutes");
  });
});
