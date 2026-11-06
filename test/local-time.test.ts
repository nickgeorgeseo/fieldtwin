import { describe, expect, it } from "vitest";
import { localTime } from "../src/core/local-time.ts";

/** A moment written as the business's local time with its UTC offset, the way Jobber's webhook samples write one. */
describe("localTime", () => {
  const ms = Date.parse("2026-07-16T22:31:31Z");

  it("writes the moment in the business's zone, offset and all", () => {
    expect(localTime(ms, -6)).toBe("2026-07-16T16:31:31-06:00");
  });

  it("carries a half-hour offset into the next day", () => {
    expect(localTime(ms, 5.5)).toBe("2026-07-17T04:01:31+05:30");
  });

  it("writes UTC as +00:00, not Z", () => {
    expect(localTime(ms, 0)).toBe("2026-07-16T22:31:31+00:00");
  });
});

describe("the business's date in Jobber's statuses", () => {
  it("reads half a millisecond before a pre-1970 local midnight as the earlier day, as QuickBooks' today does", async () => {
    const { localDate } = await import("../src/vendors/jobber/resolvers/statuses.ts");
    const { qboToday } = await import("../src/vendors/quickbooks/dates.ts");
    const nowMs = Date.parse("1969-12-31T05:00:00Z") - 0.5; // local midnight at UTC-5, less half a millisecond
    expect(localDate(nowMs, -5)).toBe("1969-12-30");
    expect(localDate(nowMs, -5)).toBe(qboToday(nowMs, -5));
  });
});
