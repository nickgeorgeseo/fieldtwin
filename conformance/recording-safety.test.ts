import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { caseId, housecallpro, type Target } from "./case.ts";
import { CASES } from "./cases/index.ts";
import { parseCommand } from "./command.ts";
import { checkTokens } from "./preflight.ts";
import { nextRecording } from "./recordings.ts";
import type { Results } from "./run.ts";
import { runningTwin, sandboxTarget } from "./targets.ts";

/**
 * Recordings are evidence, so they may not be quietly wrong: one made with a dead token or the wrong URL would make
 * every case fail as if the twin were wrong.
 */

/** A sandbox that answers every request with `status`, the way one does to an expired token. */
function sandboxAnswering(status: number, body: unknown = {}): Target {
  return {
    kind: "sandbox",
    fetch: async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    quickbooks: { apiBase: "https://sandbox-quickbooks.api.intuit.com/v3", realmId: "123", accessToken: "expired" },
    jobber: { apiUrl: "https://api.getjobber.com/api/graphql", accessToken: "expired" },
    housecallpro: { apiBase: "https://api.housecallpro.com", apiKey: "deleted" },
    now: async () => "2026-10-12T00:00:00Z",
  };
}

describe("recording against a sandbox", () => {
  it("stops before recording anything when a token is refused, and says what to do", async () => {
    await expect(checkTokens(sandboxAnswering(401), ["quickbooks"])).rejects.toThrow(
      "QuickBooks refused QBO_ACCESS_TOKEN (HTTP 401). Access tokens last an hour: get a fresh one",
    );
    await expect(checkTokens(sandboxAnswering(401, { message: "Invalid Token Error" }), ["jobber"])).rejects.toThrow(
      "Jobber refused JOBBER_ACCESS_TOKEN (HTTP 401)",
    );
  });

  it("stops when the QuickBooks base URL is wrong, rather than recording 404s", async () => {
    await expect(checkTokens(sandboxAnswering(404), ["quickbooks"])).rejects.toThrow("QBO_API_BASE");
  });

  it("stops before recording a Housecall Pro account that refuses its API key, and says which accounts have keys", async () => {
    await expect(checkTokens(sandboxAnswering(401, { message: "Unauthorized" }), ["housecallpro"])).rejects.toThrow(
      "Housecall Pro refused HOUSECALLPRO_API_KEY (HTTP 401). Use one of the account's API keys: the API is for Pros on the MAX or XL plan",
    );
  });

  it("stops when the Housecall Pro URL is wrong, rather than recording what something else answers", async () => {
    await expect(checkTokens(sandboxAnswering(404), ["housecallpro"])).rejects.toThrow("HOUSECALLPRO_API_URL");
    await expect(checkTokens(sandboxAnswering(200, { status: "ok" }), ["housecallpro"])).rejects.toThrow("HOUSECALLPRO_API_URL");
  });

  it("goes ahead when every token and key works", async () => {
    const working: Target = {
      ...sandboxAnswering(200),
      fetch: async (url) => {
        if (String(url).includes("graphql")) return Response.json({ data: { account: { id: "a" } } });
        return Response.json(String(url).includes("housecallpro") ? { id: "c", name: "A company" } : { CompanyInfo: {} });
      },
    };
    await expect(checkTokens(working, ["quickbooks", "jobber", "housecallpro"])).resolves.toBeUndefined();
  });

  it("sends a Housecall Pro account its API key in the documented form, with the path straight after the host", async () => {
    const sent: { url: string; authorization: string | null }[] = [];
    const account: Target = {
      ...sandboxAnswering(200),
      fetch: async (url, init) => {
        sent.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
        return Response.json({});
      },
    };
    await housecallpro(account, "GET", "/customers?page_size=1");
    expect(sent).toEqual([{ url: "https://api.housecallpro.com/customers?page_size=1", authorization: "Token deleted" }]);
  });

  it("doesn't record the padding of ids from a testing account with no clients, which would never match", async () => {
    const encodedIds = CASES.find((testCase) => caseId(testCase) === "jobber/encoded-id-format")!;
    await expect(encodedIds.observe(sandboxAnswering(200, { data: { clients: { nodes: [] } } }))).rejects.toThrow("no clients");
  });

  it("doesn't record the padding of ids when none of them needs any, which the twin's never do", async () => {
    const encodedIds = CASES.find((testCase) => caseId(testCase) === "jobber/encoded-id-format")!;
    const id = Buffer.from("gid://Jobber/Client/1234567").toString("base64"); // 27 bytes: base64 without padding
    await expect(encodedIds.observe(sandboxAnswering(200, { data: { clients: { nodes: [{ id }] } } }))).rejects.toThrow("can't tell");
  });
});

describe("answers that are never evidence", () => {
  const readMissing = CASES.find((testCase) => caseId(testCase) === "quickbooks/read-missing-entity")!;
  const jobberSyntax = CASES.find((testCase) => caseId(testCase) === "jobber/syntax-error")!;
  // The cases that send a body as it is, rather than one their request helper writes.
  const rawBodies = ["quickbooks/body-not-json", "jobber/body-not-json", "jobber/variables-as-a-string"].map(
    (id) => CASES.find((testCase) => caseId(testCase) === id)!,
  );

  it.each([429, 502, 503, 504])(
    "stop a case when the sandbox answers HTTP %i, throttling or down, rather than record it",
    async (status) => {
      await expect(readMissing.observe(sandboxAnswering(status))).rejects.toThrow("try again later");
      await expect(jobberSyntax.observe(sandboxAnswering(status))).rejects.toThrow("try again later");
      await expect(housecallpro(sandboxAnswering(status), "GET", "/company")).rejects.toThrow("try again later");
      for (const rawBody of rawBodies) {
        await expect(rawBody.observe(sandboxAnswering(status)), caseId(rawBody)).rejects.toThrow("try again later");
      }
    },
  );

  it("stop a case when Jobber says it is throttling, which it answers with HTTP 200", async () => {
    const throttled = { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] };
    await expect(jobberSyntax.observe(sandboxAnswering(200, throttled))).rejects.toThrow("throttling");
    for (const rawBody of rawBodies.filter((testCase) => testCase.vendor === "jobber")) {
      await expect(rawBody.observe(sandboxAnswering(200, throttled)), caseId(rawBody)).rejects.toThrow("throttling");
    }
  });

  it("stop a case when the run's own token stops working part way, but not one that sends a bad token on purpose", async () => {
    await expect(readMissing.observe(sandboxAnswering(401))).rejects.toThrow("get a fresh one");
    for (const rawBody of rawBodies) {
      await expect(rawBody.observe(sandboxAnswering(401)), caseId(rawBody)).rejects.toThrow("get a fresh one");
    }
    const badToken = CASES.find((testCase) => caseId(testCase) === "quickbooks/unknown-access-token")!;
    await expect(badToken.observe(sandboxAnswering(401))).resolves.toMatchObject({ status: 401 });
  });

  it("stop a case when Housecall Pro stops taking the run's API key, but not when a case sends another on purpose", async () => {
    await expect(housecallpro(sandboxAnswering(401), "GET", "/customers")).rejects.toThrow("stopped accepting the API key");
    const withoutKey = housecallpro(sandboxAnswering(401), "GET", "/customers", undefined, { authorization: null });
    await expect(withoutKey).resolves.toMatchObject({ status: 401 });
  });
});

describe("a recording run's results", () => {
  const quickbooksCases = CASES.filter((testCase) => testCase.vendor === "quickbooks").slice(0, 3);
  const [first, second, third] = quickbooksCases.map((testCase) => testCase.name);
  const earlier = { recordedAt: "2026-10-01T00:00:00Z", target: "sandbox", cases: { [first!]: { status: 1 }, [second!]: { status: 2 } } };

  it("keep what a case observed last time when it couldn't run this time, so one bad run can't erase evidence", () => {
    const results: Results = {
      [`quickbooks/${first}`]: { status: 10 },
      [`quickbooks/${second}`]: { error: "QuickBooks answered HTTP 503" },
      [`quickbooks/${third}`]: { error: "QuickBooks answered HTTP 503" },
    };
    const next = nextRecording(earlier, quickbooksCases, results, "2026-10-12T00:00:00Z", "sandbox");
    expect(next.recording.cases).toEqual({ [first!]: { status: 10 }, [second!]: { status: 2 } });
    expect(next.kept).toEqual([second]);
    expect(next.missing).toEqual([third]);
  });

  it("drop cases that no longer exist", () => {
    const stale = { ...earlier, cases: { ...earlier.cases, "a-case-since-removed": { status: 3 } } };
    const next = nextRecording(stale, quickbooksCases, {}, "2026-10-12T00:00:00Z", "sandbox");
    expect(Object.keys(next.recording.cases)).not.toContain("a-case-since-removed");
  });
});

describe("recording against a sandbox it can't reach", () => {
  it("names the URL, rather than saying only that a fetch failed", async () => {
    const unreachable: Target = {
      ...sandboxAnswering(200),
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    };
    await expect(checkTokens(unreachable, ["quickbooks"])).rejects.toThrow(
      "Couldn't reach QuickBooks at https://sandbox-quickbooks.api.intuit.com/v3 (fetch failed)",
    );
  });
});

describe("what the conformance command was asked to do", () => {
  it("takes npm's own --dry-run as a dry run, since npm keeps a --dry-run given without -- to itself", () => {
    expect(parseCommand(["record"], { npm_config_dry_run: "true" })).toEqual({ command: "record", dryRun: true });
    expect(parseCommand(["record", "--dry-run"], {})).toEqual({ command: "record", dryRun: true });
    expect(parseCommand(["record"], {})).toEqual({ command: "record", dryRun: false });
  });

  it("refuses a command or option it doesn't know, instead of scoring", () => {
    expect(() => parseCommand(["recrod"], {})).toThrow('unknown command "recrod"');
    expect(() => parseCommand(["record", "--dryrun"], {})).toThrow("unknown option --dryrun");
    expect(parseCommand([], {})).toEqual({ command: "score" });
  });

  it("exits with the reason when run with a misspelled command", () => {
    const cli = new URL("./cli.ts", import.meta.url).pathname;
    const run = spawnSync(process.execPath, ["--import", "tsx", cli, "recrod"], { encoding: "utf8", timeout: 20_000 });
    expect(run.stderr).toContain('conformance: unknown command "recrod"');
    expect(run.status).toBe(1);
  }, 20_000);
});

describe("which QuickBooks company a recording may write to", () => {
  it.each(["https://quickbooks.api.intuit.com/v3", "https://QuickBooks.api.intuit.com/v3", "https://u@quickbooks.api.intuit.com/v3"])(
    "never production, however its URL is written: %s",
    (QBO_API_BASE) => {
      expect(() => sandboxTarget({ QBO_ACCESS_TOKEN: "t", QBO_REALM_ID: "1", QBO_API_BASE })).toThrow("production QuickBooks");
    },
  );
});

describe("which vendors a recording covers", () => {
  it("names the missing variable when only part of QuickBooks' settings are given, instead of quietly skipping it", () => {
    expect(() => sandboxTarget({ QBO_ACCESS_TOKEN: "t", JOBBER_ACCESS_TOKEN: "j" })).toThrow("QBO_REALM_ID");
    expect(() => sandboxTarget({ QBO_REALM_ID: "1" })).toThrow("QBO_ACCESS_TOKEN");
  });

  it("records a Housecall Pro account, which has no sandbox, from its API key, at the real API's host unless told otherwise", () => {
    const { target, vendors } = sandboxTarget({ HOUSECALLPRO_API_KEY: "k" });
    expect(vendors).toEqual(["housecallpro"]);
    expect(target.housecallpro).toEqual({ apiBase: "https://api.housecallpro.com", apiKey: "k" });
    const elsewhere = sandboxTarget({ HOUSECALLPRO_API_KEY: "k", HOUSECALLPRO_API_URL: "http://localhost:4010/housecallpro/" });
    expect(elsewhere.target.housecallpro.apiBase).toBe("http://localhost:4010/housecallpro");
  });

  it("says what each vendor needs when nothing is set", () => {
    expect(() => sandboxTarget({})).toThrow(
      /QBO_ACCESS_TOKEN and QBO_REALM_ID .*JOBBER_ACCESS_TOKEN .*HOUSECALLPRO_API_KEY \(a Housecall Pro/,
    );
  });
});

describe("scoring a twin that is already running", () => {
  const twinAnswering = (status: number, body: string) => async (url: string) =>
    url === "http://localhost:4010/_twin" ? new Response(body, { status }) : new Response("Not Found", { status: 404 });

  it("finds it at a FIELDTWIN_URL written with a trailing slash", async () => {
    const twin = await runningTwin("http://localhost:4010/", twinAnswering(200, JSON.stringify({ authMode: "any-token" })));
    expect(twin).toEqual({ baseUrl: "http://localhost:4010", authMode: "any-token" });
  });

  it("says so when something other than a twin answers there", async () => {
    await expect(runningTwin("http://localhost:4010", twinAnswering(200, "<html>a dev server</html>"))).rejects.toThrow(
      "isn't a fieldtwin",
    );
  });
});

describe("npm run conformance", () => {
  it("scores a fresh twin when run from outside the checkout too", () => {
    const cli = new URL("./cli.ts", import.meta.url).pathname;
    const tsx = import.meta.resolve("tsx"); // the outer process finds tsx wherever it runs; the twin it starts must too
    const run = spawnSync(process.execPath, ["--import", tsx, cli, "score"], { cwd: tmpdir(), encoding: "utf8", timeout: 30_000 });
    expect(run.stderr).not.toContain("didn't start");
    expect(run.stdout).toMatch(/^quickbooks +cdc-nothing-changed +not recorded yet$/m);
    expect(run.status).toBe(0);
  }, 30_000);
});
