import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/** Send a GraphQL request with an explicit version header (or none). */
function jobberWithVersion(app: ReturnType<typeof setup>["app"], version: string | undefined, query = "{ account { name } }") {
  const headers: Record<string, string> = { Authorization: "Bearer t", "Content-Type": "application/json" };
  if (version !== undefined) headers["X-JOBBER-GRAPHQL-VERSION"] = version;
  return app.request("/api/graphql", { method: "POST", headers, body: JSON.stringify({ query }) });
}

describe("Jobber twin: API versions", () => {
  it("accepts every active version and reports it under extensions.versioning", async () => {
    const { app } = setup();
    for (const version of ["2026-09-25", "2025-04-16", "2022-05-23"]) {
      const body = await (await jobberWithVersion(app, version)).json();
      expect(body.data.account.name).toBeTruthy();
      expect(body.extensions.versioning).toEqual({ version });
    }
  });

  it("resolves a removed historic version to the oldest active version, as the changelog describes", async () => {
    const { app } = setup();
    const body = await (await jobberWithVersion(app, "2022-03-10")).json();
    expect(body.data.account.name).toBeTruthy();
    expect(body.extensions.versioning.version).toBe("2022-05-23");
  });

  it("rejects a missing version header, because Jobber requires one on every request", async () => {
    const { app } = setup();
    const response = await jobberWithVersion(app, undefined);
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].message).toContain("X-JOBBER-GRAPHQL-VERSION");
  });

  it("rejects a version that Jobber never released", async () => {
    const { app } = setup();
    for (const version of ["2025-06-01", "2099-01-01", "latest"]) {
      const response = await jobberWithVersion(app, version);
      expect(response.status).toBe(400);
      expect((await response.json()).errors[0].message).toContain("2026-09-25");
    }
  });
});
