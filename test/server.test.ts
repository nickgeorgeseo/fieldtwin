import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { addressOf, listenOn, loadScenarioArgument, settingsFrom } from "../src/server.ts";

/**
 * The twin accepts any bearer token by default and its control plane has no auth (it is a local test tool), so
 * it must not be reachable from the network unless someone asks for that.
 */
describe("the server", () => {
  it("listens on the loopback address only, at port 4010, by default", () => {
    expect(listenOn({})).toEqual({ hostname: "127.0.0.1", port: 4010 });
  });

  it("listens wherever FIELDTWIN_HOST and FIELDTWIN_PORT say, for running in a container", () => {
    expect(listenOn({ FIELDTWIN_HOST: "0.0.0.0", FIELDTWIN_PORT: "8080" })).toEqual({ hostname: "0.0.0.0", port: 8080 });
  });

  it("prints an address that works for where it listens, and warns only when others can reach it", () => {
    expect(addressOf("127.0.0.1", 4010)).toEqual({ url: "http://localhost:4010", reachableByOthers: false });
    expect(addressOf("::1", 4010)).toEqual({ url: "http://localhost:4010", reachableByOthers: false });
    expect(addressOf("0.0.0.0", 4010)).toEqual({ url: "http://localhost:4010", reachableByOthers: true });
    expect(addressOf("192.168.1.20", 4010)).toEqual({ url: "http://192.168.1.20:4010", reachableByOthers: true });
  });

  it("treats a setting left empty as unset, the way a compose file passes on a variable nobody set", () => {
    expect(listenOn({ FIELDTWIN_HOST: "", FIELDTWIN_PORT: "" })).toEqual({ hostname: "127.0.0.1", port: 4010 });
    expect(settingsFrom({ FIELDTWIN_SEED: "", FIELDTWIN_AUTH: "" })).toEqual({ seed: 42, auth: "any-token" });
  });

  it("says what a port looks like when FIELDTWIN_PORT isn't one", () => {
    expect(() => listenOn({ FIELDTWIN_PORT: "four thousand" })).toThrow(
      'FIELDTWIN_PORT must be a port number like 4010, not "four thousand"',
    );
  });

  it("takes its seed and auth mode from FIELDTWIN_SEED and FIELDTWIN_AUTH, and explains bad values", () => {
    expect(settingsFrom({})).toEqual({ seed: 42, auth: "any-token" });
    expect(settingsFrom({ FIELDTWIN_SEED: "7", FIELDTWIN_AUTH: "oauth" })).toEqual({ seed: 7, auth: "oauth" });
    expect(() => settingsFrom({ FIELDTWIN_SEED: "abc" })).toThrow('FIELDTWIN_SEED must be a whole number like 42, not "abc"');
  });
});

describe("the scenario named on the command line", () => {
  it("can be a ready-made scenario's name, so `npm start -- flaky-apis` works", () => {
    const { twin } = createApp();
    expect(loadScenarioArgument(twin, "flaky-apis").scenario).toBe("Flaky APIs");
  });

  it("can be a path to a YAML file", () => {
    const { twin } = createApp();
    expect(loadScenarioArgument(twin, join(import.meta.dirname, "..", "scenarios", "mismatched-books.yaml")).scenario).toBe(
      "Mismatched books",
    );
  });

  it("names the ready-made scenarios when the file doesn't exist", () => {
    const { twin } = createApp();
    expect(() => loadScenarioArgument(twin, "scenarios/no-such-file.yaml")).toThrow(
      'Can\'t read the scenario file "scenarios/no-such-file.yaml". Ready-made scenarios: flaky-apis, heat-wave-monday, mismatched-books',
    );
  });
});

/** `npm start` itself, run as a real process: the first command every new user types. */
describe("npm start", () => {
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill();
  });

  /** Runs src/server.ts the way `npm start` does, collecting what it prints. */
  function start(port: number, args: string[] = [], checkout = join(import.meta.dirname, "..")) {
    const child = spawn(process.execPath, ["--import", "tsx", join(checkout, "src", "server.ts"), ...args], {
      env: { ...process.env, FIELDTWIN_PORT: String(port) },
    });
    children.push(child);
    let output = "";
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const printed = (text: string) =>
      new Promise<string>((resolve, reject) => {
        const check = () => (output.includes(text) ? resolve(output) : undefined);
        child.stderr.on("data", check);
        child.on("exit", () =>
          output.includes(text) ? resolve(output) : reject(new Error(`Exited without printing "${text}":\n${output}`)),
        );
        check();
      });
    const exited = new Promise<number | null>((resolve) => child.on("exit", resolve));
    return { printed, exited };
  }

  it("serves the twin and says where", async () => {
    const port = await freePort();
    const server = start(port);
    await server.printed(`is open for business at http://localhost:${port}`);
    const response = await fetch(`http://localhost:${port}/_twin`);
    expect(response.status).toBe(200);
  }, 20_000);

  it("says the port it really listens on when FIELDTWIN_PORT is 0, which lets the system pick one", async () => {
    const output = await start(0).printed("is open for business at");
    const port = Number(/localhost:(\d+)/.exec(output)?.[1]);
    expect(port).toBeGreaterThan(0);
    expect((await fetch(`http://localhost:${port}/_twin`)).status).toBe(200);
  }, 20_000);

  it("starts through a symlinked path too, instead of exiting without a word", async () => {
    const linked = join(mkdtempSync(join(tmpdir(), "fieldtwin-")), "checkout");
    symlinkSync(join(import.meta.dirname, ".."), linked);
    try {
      const port = await freePort();
      await start(port, [], linked).printed(`is open for business at http://localhost:${port}`);
    } finally {
      rmSync(dirname(linked), { recursive: true });
    }
  }, 20_000);

  it("explains how to pick another port when its port is taken, instead of crashing", async () => {
    const port = await freePort();
    const blocker = createServer().listen(port, "127.0.0.1");
    try {
      const server = start(port);
      const output = await server.printed("already in use");
      expect(output).toContain(
        `fieldtwin: port ${port} is already in use (is another twin running?). Set FIELDTWIN_PORT to use another one.`,
      );
      expect(output).not.toContain("open for business");
      expect(await server.exited).toBe(1);
    } finally {
      blocker.close();
    }
  }, 20_000);

  it("explains a scenario it can't load, instead of printing a stack trace", async () => {
    const server = start(await freePort(), ["no-such-scenario"]);
    const output = await server.printed("No scenario named");
    expect(output).toContain('fieldtwin: No scenario named "no-such-scenario". Available: flaky-apis, heat-wave-monday, mismatched-books');
    expect(output).not.toContain("    at ");
    expect(await server.exited).toBe(1);
  }, 20_000);
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

describe("GET /, where a browser lands first", () => {
  it("says where each API, the control plane, and the docs are, instead of 404", async () => {
    const { app } = createApp();
    const response = await app.request("http://localhost:4010/");
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page).toMatchObject({
      fieldtwin: "Rowntree Electric is open for business",
      quickbooks: {
        baseUrl: "http://localhost:4010",
        realmId: "9341000000000001",
        try: "GET http://localhost:4010/v3/company/9341000000000001/customer/1",
      },
      jobber: { graphql: "POST http://localhost:4010/api/graphql" },
      controlPlane: "GET http://localhost:4010/_twin",
      docs: "https://github.com/nickgeorgeseo/fieldtwin#readme",
    });
    expect(page.jobber.headers["X-JOBBER-GRAPHQL-VERSION"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
