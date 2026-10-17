import { type AppOptions, createApp } from "../src/app.ts";
import { TWIN_REALM_ID } from "../src/vendors/quickbooks/seed.ts";

/** A fresh twin plus small helpers that read like the requests a real client would make. */
export function setup(seed = 42, options: Omit<AppOptions, "seed"> = {}) {
  const { app, twin } = createApp({ seed, ...options });
  const auth = { Authorization: "Bearer test-token" };
  const qbo = `/v3/company/${TWIN_REALM_ID}`;
  const hcpAuth = { Authorization: "Token test-key" }; // a Housecall Pro API key
  const hcpWrite = (method: string) => (path: string, body: unknown) =>
    app.request(`/housecallpro${path}`, {
      method,
      headers: { ...hcpAuth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    app,
    twin,
    qboGet: (path: string) => app.request(`${qbo}${path}`, { headers: auth }),
    qboPost: (path: string, body: unknown) =>
      app.request(`${qbo}${path}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    jobber: (query: string, variables?: Record<string, unknown>) => jobberAs(app, "test-token", query, variables),
    /** The same request, made with a specific access token (a different app, or a fresh token). */
    jobberAs: (token: string, query: string, variables?: Record<string, unknown>) => jobberAs(app, token, query, variables),
    /** Housecall Pro, at the twin's /housecallpro, the way a client whose base URL is http://localhost:4010/housecallpro calls it. */
    hcpGet: (path: string) => app.request(`/housecallpro${path}`, { headers: hcpAuth }),
    hcpPost: hcpWrite("POST"),
    hcpPut: hcpWrite("PUT"),
  };
}

function jobberAs(app: ReturnType<typeof createApp>["app"], token: string, query: string, variables?: Record<string, unknown>) {
  return app.request("/api/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-JOBBER-GRAPHQL-VERSION": "2025-04-16" },
    body: JSON.stringify({ query, variables }),
  });
}
