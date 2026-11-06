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

  it("answers a chain of fragment spreads too long to validate with HTTP 200 and an errors list, not a 500", async () => {
    const { jobber } = setup();
    const chain = Array.from({ length: 6_000 }, (_, n) => `fragment F${n} on Account { id ...F${n + 1} }`).join("\n");
    const response = await jobber(`{ account { ...F0 } }\n${chain}\nfragment F6000 on Account { id }`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeUndefined();
    expect(body.errors[0].message).toBeTruthy();
  });

  it("answers fragments nested thousands deep that pass validation with HTTP 200, not a 500 from pricing them", async () => {
    // Each fragment wraps the next spread in 20 inline fragments: a short chain that validates quickly but nests
    // deeply. How deep the stack goes depends on the machine, so the chain grows a step at a time.
    const inline = (n: number) => `${"... on Account { ".repeat(20)}id ...F${n + 1}${" }".repeat(20)}`;
    for (const length of [200, 300, 400]) {
      const { jobber } = setup();
      const chain = Array.from({ length }, (_, n) => `fragment F${n} on Account { ${inline(n)} }`).join("\n");
      const response = await jobber(`{ account { ...F0 } }\n${chain}\nfragment F${length} on Account { name }`);
      expect(response.status, `a chain of ${length}`).toBe(200);
      const body = await response.json();
      expect(body.data?.account ?? body.errors[0].message).toBeTruthy();
    }
  });

  it("prices fragments that each spread the next one twice at once, as the fields they reach, not once per spread", async () => {
    // Thirty levels that each spread the next twice: under 2 KB of query, but 2^30 spreads if each were walked again.
    const { jobber } = setup();
    const chain = Array.from({ length: 30 }, (_, n) => `fragment F${n} on Account { ...F${n + 1} ...F${n + 1} }`).join("\n");
    const body = await (await jobber(`{ account { ...F0 } }\n${chain}\nfragment F30 on Account { id name }`)).json();
    expect(Object.keys(body.data.account)).toEqual(["id", "name"]);
    expect(body.extensions.cost.requestedQueryCost).toBe(3);
    expect(body.extensions.cost.actualQueryCost).toBe(3);
  });

  it("prices a fragment spread under two aliases at every level at once, though the answer would double at each", async () => {
    // The answer has 2^24 places, one per path of a: and b:, but they hold the same few selections, priced once each.
    const chain = (first: number) =>
      Array.from({ length: 24 }, (_, n) => {
        const half = (alias: string) => `${alias}: jobs(first: ${first}) { nodes { client { ...F${n + 1} } } }`;
        return `fragment F${n} on Client { ${half("a")} ${half("b")} }`;
      }).join("\n");
    const query = (first: number) =>
      `{ client(id: "Z2lkOi8vSm9iYmVyL0NsaWVudC8x") { ...F0 } }\n${chain(first)}\nfragment F24 on Client { id }`;
    const { jobber } = setup();
    const started = performance.now();
    const empty = await (await jobber(query(0))).json();
    const doubling = await (await jobber(query(1))).json();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(empty.extensions.cost.requestedQueryCost).toBe(1); // nothing under a page of 0 costs anything
    expect(doubling.extensions.cost.requestedQueryCost).toBe(3 * 2 ** 24 - 1);
    expect(doubling.errors[0].extensions.code).toBe("THROTTLED");
  });

  it("prices fragments that nest fields fifteen hundred levels deep at once, without running out of stack", async () => {
    const { jobber } = setup();
    const chain = Array.from(
      { length: 1500 },
      (_, n) => `fragment F${n} on Client { jobs(first: 2) { nodes { client { ...F${n + 1} } } } }`,
    );
    const started = performance.now();
    const response = await jobber(
      `{ client(id: "Z2lkOi8vSm9iYmVyL0NsaWVudC8x") { ...F0 } }\n${chain.join("\n")}\nfragment F1500 on Client { id }`,
    );
    expect(performance.now() - started).toBeLessThan(1000);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.extensions.cost.requestedQueryCost).toBe(Number.MAX_SAFE_INTEGER); // 2^1500 pages, stopped at the cap
    expect(body.errors[0].extensions.code).toBe("THROTTLED");
  });

  it("answers a query whose fragments merge differently down every path with an error at once, not after hours of pricing", async () => {
    // F's a: branch merges in a fresh G chain at every level, so each path down holds its own mix of G fragments:
    // 2^16 different selections, each priced separately, with no shortcut that stays exact.
    const half = (alias: string, inner: string) => `${alias}: jobs(first: 1) { nodes { client { ${inner} } } }`;
    const fragments = Array.from({ length: 16 }, (_, n) => [
      `fragment F${n} on Client { ${half("a", `...F${n + 1} ...G0`)} ${half("b", `...F${n + 1}`)} }`,
      `fragment G${n} on Client { ${half("a", `...G${n + 1}`)} ${half("b", `...G${n + 1}`)} }`,
    ]).flat();
    const { jobber } = setup();
    const started = performance.now();
    const response = await jobber(
      `{ client(id: "Z2lkOi8vSm9iYmVyL0NsaWVudC8x") { ...F0 } }\n${fragments.join("\n")}\nfragment F16 on Client { id }\nfragment G16 on Client { name }`,
    );
    expect(performance.now() - started).toBeLessThan(1000);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeUndefined();
    expect(body.errors[0].message).toContain("too complex to price");
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

  it("rejects any value that is not an EncodedId the documented way, even one String() or JSON can't write", async () => {
    const { app, jobber } = setup();
    const query = "query ($id: EncodedId!) { client(id: $id) { id } }";
    for (const id of [{ toString: 1 }, { toString: null }, { toString: "x", valueOf: "y" }, [{ toString: 1 }]]) {
      const response = await jobber(query, { id });
      expect(response.status).toBe(200);
      expect((await response.json()).errors[0].message).toBe("Variable $id of type EncodedId! was provided invalid value");
    }
    // Nested deeper than JSON.stringify or Array.join can go: sent as raw JSON, since the client's JSON.stringify can't write it either.
    for (const id of [`${"[".repeat(5_000)}1${"]".repeat(5_000)}`, `${'{"a":'.repeat(20_000)}1${"}".repeat(20_000)}`]) {
      const response = await app.request("/api/graphql", {
        method: "POST",
        headers: { Authorization: "Bearer t", "Content-Type": "application/json", "X-JOBBER-GRAPHQL-VERSION": "2025-04-16" },
        body: `{"query": ${JSON.stringify(query)}, "variables": {"id": ${id}}}`,
      });
      expect(response.status).toBe(200);
      expect((await response.json()).errors[0].message).toBe("Variable $id of type EncodedId! was provided invalid value");
    }
  });

  it("says a list was sent, not that the id is invalid, when an EncodedId variable gets a list holding one", async () => {
    const { jobber } = setup();
    const query = "query ($id: EncodedId!) { client(id: $id) { id } }";
    const id = Buffer.from("gid://Jobber/Client/1").toString("base64");
    const body = await (await jobber(query, { id: [id] })).json();
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].message).toBe("Variable $id of type EncodedId! was provided invalid value");
    const [problem] = body.errors[0].extensions.problems;
    expect(problem.path).toEqual([]);
    expect(problem.explanation).toContain("not a list");
    expect(problem.explanation).not.toContain("is not a valid EncodedId");
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

  it("returns null for an id that spells a record's number another way, like gid://Jobber/Client/01", async () => {
    const { jobber } = setup();
    const query = "query ($id: EncodedId!) { client(id: $id) { id } }";
    for (const number of ["01", "001"]) {
      const id = Buffer.from(`gid://Jobber/Client/${number}`).toString("base64");
      const body = await (await jobber(query, { id })).json();
      expect(body, number).toMatchObject({ data: { client: null } });
    }
  });

  it("returns null for an id whose last base64 character carries bits the twin's own id doesn't", async () => {
    // Base64 decoding ignores the unused low bits of the last character, so ...xMB== decodes like Client 10's ...xMA==.
    const { jobber } = setup();
    const query = "query ($id: EncodedId!) { client(id: $id) { id } }";
    const own = Buffer.from("gid://Jobber/Client/10").toString("base64");
    expect(own).toBe("Z2lkOi8vSm9iYmVyL0NsaWVudC8xMA==");
    for (const id of ["Z2lkOi8vSm9iYmVyL0NsaWVudC8xMB==", "Z2lkOi8vSm9iYmVyL0NsaWVudC8xMB"]) {
      expect(await (await jobber(query, { id })).json(), id).toMatchObject({ data: { client: null } });
    }
  });
});

describe("Jobber twin: ids with and without padding", () => {
  it("finds a record whether its id keeps the base64 padding or not, since Jobber's own examples do both", async () => {
    const harness = setup();
    const padded = Buffer.from("gid://Jobber/Client/10").toString("base64");
    expect(padded.endsWith("=")).toBe(true);
    const unpadded = padded.replace(/=+$/, "");
    const query = "query ($id: EncodedId!) { client(id: $id) { id name } }";
    const fromPadded = (await (await harness.jobber(query, { id: padded })).json()).data.client;
    const fromUnpadded = (await (await harness.jobber(query, { id: unpadded })).json()).data.client;
    expect(fromPadded).not.toBeNull();
    expect(fromUnpadded).toEqual(fromPadded);
  });
});
