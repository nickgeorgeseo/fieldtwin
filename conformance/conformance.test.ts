import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { caseId, quickbooks, type Target } from "./case.ts";
import { CASES } from "./cases/index.ts";
import { readRecordings } from "./recordings.ts";
import { compare, observeAll, report } from "./run.ts";
import { twinTarget } from "./targets.ts";

/**
 * The twin, held to recordings of the real APIs. Every case runs against an in-process twin; a case that has been
 * recorded against a vendor sandbox (npm run conformance:record) must match the recording, and one that hasn't
 * shows as a todo. See conformance/README.md.
 */
const { app } = createApp({ seed: 42, auth: "oauth" });
const target = await twinTarget("http://twin.test", async (url, init) => app.request(url, init));
const observed = await observeAll(target, CASES);
const recordings = readRecordings();

describe("conformance cases", () => {
  it("all run against the twin and observe something", () => {
    for (const testCase of CASES) {
      expect(observed[caseId(testCase)], caseId(testCase)).not.toHaveProperty("error");
      expect(Object.keys(observed[caseId(testCase)] ?? {}).length, caseId(testCase)).toBeGreaterThan(0);
    }
  });

  it("have unique names within each vendor, and name an endpoint", () => {
    expect(new Set(CASES.map(caseId)).size).toBe(CASES.length);
    for (const testCase of CASES) expect(testCase.endpoint, caseId(testCase)).toBeTruthy();
  });

  it("each check a row that FIDELITY.md really has", () => {
    const rows = new Set(
      readFileSync(new URL("../FIDELITY.md", import.meta.url), "utf8")
        .split("\n")
        .filter((line) => line.startsWith("| ") && !line.startsWith("|---"))
        .map((line) => line.split("|")[1]!.trim().replaceAll("`", "")),
    );
    for (const testCase of CASES) expect(rows, caseId(testCase)).toContain(testCase.fidelity);
  });
});

describe("a twin as a target", () => {
  it("lets time pass when asked for now, as it does for a sandbox, so nothing written before then has changed since", async () => {
    const { app: written } = createApp({ seed: 42 });
    const twin = await twinTarget("http://twin.test", async (url, init) => written.request(url, init));
    await quickbooks(twin, "POST", "customer", { DisplayName: "Written Just Before" });
    const cdc = CASES.find((testCase) => caseId(testCase) === "quickbooks/cdc-nothing-changed")!;
    expect(await cdc.observe(twin)).toEqual({ status: 200, groupKeys: [] });
  });
});

describe("the ORDERBY case", () => {
  /** A company whose queries sort text the way a plain string comparison does, capitals first. */
  function booksSortingByCharacterCode(): Target {
    const names: string[] = [];
    return {
      kind: "sandbox",
      fetch: async (url, init) => {
        if (init?.method === "POST") {
          const { DisplayName } = JSON.parse(String(init.body));
          names.push(DisplayName);
          return Response.json({ Customer: { Id: String(names.length), DisplayName } });
        }
        const statement = new URL(String(url)).searchParams.get("query") ?? "";
        const prefix = /like '([^%']*)%'/i.exec(statement)?.[1] ?? "";
        const sorted = names.filter((name) => name.startsWith(prefix)).sort();
        return Response.json({ QueryResponse: { Customer: sorted.map((DisplayName) => ({ DisplayName })) } });
      },
      quickbooks: { apiBase: "https://books.test/v3", realmId: "1", accessToken: "t" },
      jobber: { apiUrl: "https://jobber.test/api/graphql", accessToken: "t" },
      now: async () => "2026-10-12T00:00:00Z",
    };
  }

  it("tells a sort that puts capitals first from one that ignores case, whatever customers the company has", async () => {
    const orderby = CASES.find((testCase) => caseId(testCase) === "quickbooks/orderby-text-case")!;
    expect(await orderby.observe(booksSortingByCharacterCode())).not.toEqual(observed[caseId(orderby)]);
  });
});

describe("the conformance score", () => {
  it("counts the observations that match, and names each one that differs", () => {
    const result = compare({ status: 404, code: "610", type: "ValidationFault" }, { status: 400, code: "610", type: "ValidationFault" });
    expect(result).toEqual({ matched: 2, total: 3, differences: [{ key: "status", recorded: 404, twin: 400 }] });
  });

  it("reports each recorded case's score and differences, a score per endpoint, and the cases not recorded yet", () => {
    const [missing, stale] = [CASES.find((c) => c.name === "read-missing-entity")!, CASES.find((c) => c.name === "stale-synctoken")!];
    const twin = { [caseId(missing)]: { status: 400, code: "610" }, [caseId(stale)]: { status: 400, code: "5010" } };
    const recording = {
      recordedAt: "2026-10-12T00:00:00Z",
      target: "test",
      cases: { "read-missing-entity": { status: 404, code: "610" } },
    };
    const text = report([missing, stale], twin, { quickbooks: recording });
    expect(text).toContain("read-missing-entity                1/2");
    expect(text).toContain("status: real 404, twin 400   (FIDELITY.md: HTTP status of 610 on a read)");
    expect(text).toContain("stale-synctoken                    not recorded yet");
    expect(text).toContain("GET /customer/{id}                 1/2 observations match (50%)");
    expect(text).toContain("Fidelity: 1/2 observations match (50%)");
  });

  const readMissing = CASES.find((testCase) => testCase.name === "read-missing-entity")!;
  const recordingOf = (observations: Record<string, string | number>) => ({
    recordedAt: "2026-10-12T00:00:00Z",
    target: "test",
    cases: { "read-missing-entity": observations },
  });

  it("leaves out the per-endpoint scores, heading and all, while nothing is recorded", () => {
    const text = report([readMissing], { [caseId(readMissing)]: { status: 404 } }, {});
    expect(text).not.toContain("By endpoint");
    expect(text).toContain("Fidelity: nothing recorded yet");
  });

  it("counts a recorded case the twin couldn't run as nothing matched, rather than leaving it out", () => {
    const text = report(
      [readMissing],
      { [caseId(readMissing)]: { error: "the twin crashed" } },
      { quickbooks: recordingOf({ status: 404, code: "610" }) },
    );
    expect(text).toContain("the twin couldn't run it: the twin crashed");
    expect(text).toContain("GET /customer/{id}                 0/2 observations match (0%)");
    expect(text).toContain("Fidelity: 0/2 observations match (0%)");
  });

  it("never rounds a score up: 2 of 3 is 66%, and nothing short of all is 100%", () => {
    const text = report(
      [readMissing],
      { [caseId(readMissing)]: { status: 404, code: "610", type: "x" } },
      { quickbooks: recordingOf({ status: 404, code: "610", type: "y" }) },
    );
    expect(text).toContain("Fidelity: 2/3 observations match (66%)");
  });

  it("counts an observation the twin doesn't make as a difference", () => {
    expect(compare({ a: 1, b: 2 }, { a: 1 })).toMatchObject({ matched: 1, total: 2, differences: [{ key: "b", recorded: 2 }] });
  });

  it("counts what only the twin observes, and tells a recorded null from nothing at all, as the test does", () => {
    expect(compare({ a: 1 }, { a: 1, b: 2 })).toMatchObject({ matched: 1, total: 2, differences: [{ key: "b", twin: 2 }] });
    expect(compare({ a: null }, {})).toMatchObject({ matched: 0, total: 1 });
  });
});

describe("the twin against recordings of the real APIs", () => {
  for (const testCase of CASES) {
    const recorded = recordings[testCase.vendor]?.cases[testCase.name];
    const title = `${testCase.vendor} ${testCase.name}: ${testCase.fidelity}`;
    if (!recorded) {
      it.todo(`${title} (not recorded yet)`);
    } else {
      it(`${title} matches what the real API did`, () => {
        const twin = observed[caseId(testCase)]!;
        expect("error" in twin ? twin : compare(recorded, twin).differences).toEqual([]);
      });
    }
  }
});
