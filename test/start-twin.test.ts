import { createServer } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type RunningTwin, startTwin } from "../src/index.ts";

/** startTwin() from a test file in someone else's project: a twin of its own on a port of its own, closed after. */
describe("startTwin()", () => {
  const running: RunningTwin[] = [];
  afterEach(async () => {
    await Promise.all(running.splice(0).map((twin) => twin.close()));
  });
  const start = async (options?: Parameters<typeof startTwin>[0]) => {
    const twin = await startTwin(options);
    running.push(twin);
    return twin;
  };

  it("serves the twin on a free port on the loopback address and says where", async () => {
    const twin = await start();
    expect(twin.url).toBe(`http://localhost:${twin.port}`);
    expect(twin.port).toBeGreaterThan(0);
    const status = await (await fetch(`${twin.url}/_twin`)).json();
    expect(status.seed).toBe(42);
  });

  it("starts as many twins as a test runner has workers, each with its own world", async () => {
    const [first, second] = await Promise.all([start(), start()]);
    expect(first!.port).not.toBe(second!.port);
    await fetch(`${first!.url}/_twin/clock/advance`, { method: "POST", body: JSON.stringify({ minutes: 120 }) });
    const timeOf = async (twin: RunningTwin) => (await (await fetch(`${twin.url}/_twin`)).json()).twinTime;
    expect(await timeOf(first!)).not.toBe(await timeOf(second!));
  });

  it("takes a seed and an auth mode, as FIELDTWIN_SEED and FIELDTWIN_AUTH do", async () => {
    const twin = await start({ seed: 7, auth: "oauth" });
    expect(await (await fetch(`${twin.url}/_twin`)).json()).toMatchObject({ seed: 7, authMode: "oauth" });
  });

  it("takes a ready-made scenario by name, which brings its own seed", async () => {
    const twin = await start({ scenario: "mismatched-books" });
    expect(await (await fetch(`${twin.url}/_twin`)).json()).toMatchObject({ seed: 21, scenario: "Mismatched books" });
  });

  it("takes a scenario as a path to a YAML file", async () => {
    const twin = await start({ scenario: join(import.meta.dirname, "..", "scenarios", "flaky-apis.yaml") });
    expect(twin.twin.scenario).toBe("Flaky APIs");
  });

  it("refuses a scenario it doesn't know, naming the ready-made ones, before it listens", async () => {
    await expect(startTwin({ scenario: "no-such-scenario" })).rejects.toThrow("flaky-apis, heat-wave-monday, mismatched-books");
  });

  it("refuses to start when its port is taken, saying so instead of crashing the test run", async () => {
    const blocker = createServer().listen(0, "127.0.0.1");
    await new Promise((resolve) => blocker.once("listening", resolve));
    const address = blocker.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      await expect(startTwin({ port })).rejects.toThrow(`port ${port} is already in use`);
    } finally {
      blocker.close();
    }
  });

  it("frees its port when closed, even with a client still connected", async () => {
    const twin = await startTwin();
    await fetch(`${twin.url}/_twin`, { headers: { Connection: "keep-alive" } });
    await twin.close();
    await expect(fetch(`${twin.url}/_twin`)).rejects.toThrow();
  });
});
