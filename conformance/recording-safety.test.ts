import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { caseId, type Target } from "./case.ts";
import { CASES } from "./cases/index.ts";
import { parseCommand } from "./command.ts";
import { checkTokens } from "./preflight.ts";
import { nextRecording } from "./recordings.ts";
import type { Results } from "./run.ts";

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

  it("goes ahead when every token works", async () => {
    const working: Target = {
      ...sandboxAnswering(200),
      fetch: async (url) =>
        new Response(JSON.stringify(String(url).includes("graphql") ? { data: { account: { id: "a" } } } : { CompanyInfo: {} }), {
          status: 200,
        }),
    };
    await expect(checkTokens(working, ["quickbooks", "jobber"])).resolves.toBeUndefined();
  });

  it("doesn't record the padding of ids from a testing account with no clients, which would never match", async () => {
    const encodedIds = CASES.find((testCase) => caseId(testCase) === "jobber/encoded-id-format")!;
    await expect(encodedIds.observe(sandboxAnswering(200, { data: { clients: { nodes: [] } } }))).rejects.toThrow("no clients");
  });
});

describe("answers that are never evidence", () => {
  const readMissing = CASES.find((testCase) => caseId(testCase) === "quickbooks/read-missing-entity")!;
  const jobberSyntax = CASES.find((testCase) => caseId(testCase) === "jobber/syntax-error")!;

  it.each([429, 502, 503, 504])(
    "stop a case when the sandbox answers HTTP %i, throttling or down, rather than record it",
    async (status) => {
      await expect(readMissing.observe(sandboxAnswering(status))).rejects.toThrow("try again later");
      await expect(jobberSyntax.observe(sandboxAnswering(status))).rejects.toThrow("try again later");
    },
  );

  it("stop a case when Jobber says it is throttling, which it answers with HTTP 200", async () => {
    const throttled = { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] };
    await expect(jobberSyntax.observe(sandboxAnswering(200, throttled))).rejects.toThrow("throttling");
  });

  it("stop a case when the run's own token stops working part way, but not one that sends a bad token on purpose", async () => {
    await expect(readMissing.observe(sandboxAnswering(401))).rejects.toThrow("get a fresh one");
    const badToken = CASES.find((testCase) => caseId(testCase) === "quickbooks/unknown-access-token")!;
    await expect(badToken.observe(sandboxAnswering(401))).resolves.toMatchObject({ status: 401 });
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
