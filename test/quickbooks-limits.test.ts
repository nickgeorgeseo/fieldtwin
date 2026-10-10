import { describe, expect, it } from "vitest";
import { createCheckpoint, rewindTo } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

/**
 * QuickBooks' documented limits: https://developer.intuit.com/app/developer/qbo/docs/learn/limits-and-throttles
 * "500 requests per minute per realm ID." "You'll see HTTP Status Code 429 when throttling occurs. If you see this,
 * wait 60 seconds before retrying the request."
 */
const SECONDS = 1000;

function company() {
  const harness = setup();
  /** One read, made with a given app's token. */
  const read = (token = "app-a") =>
    harness.app.request(`/v3/company/9341000000000001/customer/1`, { headers: { Authorization: `Bearer ${token}` } });
  /** `count` reads, one after another, with no twin time passing: the statuses they got. */
  const reads = async (count: number, token?: string) => {
    const statuses: number[] = [];
    for (let i = 0; i < count; i++) statuses.push((await read(token)).status);
    return statuses;
  };
  return { ...harness, read, reads };
}

const times = (count: number, status: number) => Array.from({ length: count }, () => status);

describe("QuickBooks twin: rate limits", () => {
  it("answers the 501st request in a minute with HTTP 429 ThrottleExceeded", async () => {
    const { read, reads } = company();
    expect(await reads(500)).toEqual(times(500, 200));

    const throttled = await read();
    expect(throttled.status).toBe(429);
    const { Fault } = await throttled.json();
    expect(Fault.type).toBe("SERVICE");
    expect(Fault.Error[0]).toMatchObject({ code: "003001", Message: "ThrottleExceeded", Detail: expect.stringContaining("60 seconds") });
  });

  it("lets requests through again only once 60 seconds of twin time have passed", async () => {
    const { twin, read, reads } = company();
    await reads(501);
    twin.advance(60 * SECONDS - 1);
    expect((await read()).status).toBe(429);
    twin.advance(1);
    expect(await reads(500)).toEqual(times(500, 200));
    expect((await read()).status).toBe(429);
  });

  it("counts the last 60 seconds, not the calendar minute", async () => {
    const { twin, read, reads } = company();
    await reads(300);
    twin.advance(30 * SECONDS);
    expect(await reads(200)).toEqual(times(200, 200));
    expect((await read()).status).toBe(429);
    twin.advance(30 * SECONDS); // the first 300 are now a minute old
    expect(await reads(300)).toEqual(times(300, 200));
    expect((await read()).status).toBe(429);
  });

  it("shares one budget among every app using the company, and refuses a throttled write without making it", async () => {
    const { app, twin, reads } = company();
    await reads(250, "app-a");
    await reads(250, "app-b");
    const before = twin.log.length;

    const write = await app.request("/v3/company/9341000000000001/customer", {
      method: "POST",
      headers: { Authorization: "Bearer app-c", "Content-Type": "application/json" },
      body: JSON.stringify({ DisplayName: "Wren Hook" }),
    });
    expect(write.status).toBe(429);
    expect(twin.log.length).toBe(before);
  });

  it("starts the budget full again after a reset or a rewind", async () => {
    const { twin, read, reads } = company();
    createCheckpoint(twin, "start");
    await reads(501);
    rewindTo(twin, "start");
    expect((await read()).status).toBe(200);

    await reads(500);
    twin.reset();
    expect((await read()).status).toBe(200);
  });
});
