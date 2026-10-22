import { describe, expect, it } from "vitest";
import { caseId, housecallpro } from "./case.ts";
import { CASES } from "./cases/index.ts";
import { nextRecording } from "./recordings.ts";
import { observeAll, type Results } from "./run.ts";
import { caseNamed, fakeTarget, sandboxAnswering } from "./test-support.ts";

/**
 * What reaches a recording from a sandbox's answers, and what never does: the run's own token or key, however an
 * answer repeats it, and answers that say nothing about the API.
 */

describe("recording a sandbox that sends the credential back", () => {
  it.each(["quickbooks", "jobber"] as const)(
    "keeps the %s access token out of what it records and what it says, even from a sandbox that echoes it",
    async (vendor) => {
      const echoing = fakeTarget(async (_, init) => {
        const token = new Headers(init?.headers).get("Authorization");
        const quickbooks = { Fault: { Error: [{ code: token, Message: token }] }, Customer: { Id: token, SyncToken: token } };
        const jobber = { data: { account: { id: token } }, errors: [{ message: token, extensions: { code: token } }] };
        return Response.json({ ...quickbooks, ...jobber, QueryResponse: { Customer: [{ Id: token }] } });
      });
      const cases = CASES.filter((testCase) => testCase.vendor === vendor);
      const results = await observeAll(echoing, cases);
      const { recording } = nextRecording(undefined, cases, results, "2026-10-12T00:00:00Z", "test");
      expect(Object.keys(recording.cases).length).toBeGreaterThan(0);
      expect(JSON.stringify(recording)).not.toContain(echoing[vendor].accessToken);
      expect(JSON.stringify(results)).not.toContain(echoing[vendor].accessToken);
    },
  );
});

describe("answers that are never evidence", () => {
  const readMissing = caseNamed("quickbooks/read-missing-entity");
  const jobberSyntax = caseNamed("jobber/syntax-error");
  // The cases that send a body as it is, rather than one their request helper writes.
  const rawBodies = ["quickbooks/body-not-json", "jobber/body-not-json", "jobber/variables-as-a-string", "housecallpro/body-not-json"].map(
    caseNamed,
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
      const stale = rawBody.vendor === "housecallpro" ? "stopped accepting the API key" : "get a fresh one";
      await expect(rawBody.observe(sandboxAnswering(401)), caseId(rawBody)).rejects.toThrow(stale);
    }
    const badToken = caseNamed("quickbooks/unknown-access-token");
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
