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

describe("Jobber twin: errors and ids", () => {
  it("answers GraphQL syntax and validation errors with HTTP 200 and an errors list, as Jobber documents", async () => {
    const { jobber } = setup();
    for (const query of ["{ account { name }", "{ acount { name } }"]) {
      const response = await jobber(query);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data).toBeUndefined();
      expect(body.errors[0].message).toBeTruthy();
    }
  });

  it("rejects a variable that is not an EncodedId, in Jobber's documented error shape", async () => {
    const { jobber } = setup();
    const body = await (await jobber("query SampleQuery($id: EncodedId!) { client(id: $id) { id } }", { id: "1" })).json();
    expect(body.errors).toEqual([
      {
        message: "Variable $id of type EncodedId! was provided invalid value",
        locations: [{ line: 1, column: 19 }],
        extensions: {
          value: "1",
          problems: [{ path: [], explanation: "'1' is not a valid EncodedId", message: "'1' is not a valid EncodedId" }],
        },
      },
    ]);
  });

  it("rejects an id written inline in the query that is not an EncodedId", async () => {
    const { jobber } = setup();
    const body = await (await jobber('{ client(id: "1") { id } }')).json();
    expect(body.errors[0].message).toContain("'1' is not a valid EncodedId");
  });

  it("makes ids the documented way: base64 of a gid://Jobber global id", async () => {
    const { jobber } = setup();
    const body = await (await jobber("{ clients(first: 1) { nodes { id } } }")).json();
    const id: string = body.data.clients.nodes[0].id;
    expect(Buffer.from(id, "base64").toString()).toBe("gid://Jobber/Client/1");
  });

  it("returns null, not an error, for a well-formed id that matches nothing", async () => {
    const { jobber } = setup();
    const missing = Buffer.from("gid://Jobber/Client/99999").toString("base64");
    const body = await (await jobber("query ($id: EncodedId!) { client(id: $id) { id } }", { id: missing })).json();
    expect(body).toMatchObject({ data: { client: null } });
    expect(body.errors).toBeUndefined();
  });
});
