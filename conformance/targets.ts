import type { Target } from "./case.ts";

type Fetch = Target["fetch"];

/**
 * A twin at baseUrl, reached over HTTP like any client. It is switched to real token checks (so the cases about
 * bad tokens mean something) and connected through its own OAuth endpoints, with no browser.
 *
 * Twin time stands still between requests, where a sandbox's moves on, so asking for now moves it a second first:
 * otherwise a record written just before would count as changed since "now".
 */
export async function twinTarget(baseUrl: string, fetchImpl: Fetch = (url, init) => fetch(url, init)): Promise<Target> {
  const json = { "Content-Type": "application/json" };
  await fetchImpl(`${baseUrl}/_twin/auth`, { method: "PUT", headers: json, body: JSON.stringify({ mode: "oauth" }) });

  const redirectUri = "http://localhost:3000/callback";
  const codeFrom = async (authorizeUrl: string) => {
    const response = await fetchImpl(authorizeUrl, { redirect: "manual" });
    return new URL(response.headers.get("Location") ?? "about:blank").searchParams;
  };
  const tokenFrom = async (response: Response) => ((await response.json()) as { access_token: string }).access_token;

  const qbo = await codeFrom(
    `${baseUrl}/connect/oauth2?response_type=code&client_id=conformance&scope=com.intuit.quickbooks.accounting&redirect_uri=${redirectUri}`,
  );
  const qboToken = await tokenFrom(
    await fetchImpl(`${baseUrl}/oauth2/v1/tokens/bearer`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from("conformance:not-a-secret").toString("base64")}` },
      body: new URLSearchParams({ grant_type: "authorization_code", code: qbo.get("code") ?? "", redirect_uri: redirectUri }),
    }),
  );
  const jobber = await codeFrom(`${baseUrl}/api/oauth/authorize?response_type=code&client_id=conformance&redirect_uri=${redirectUri}`);
  const jobberToken = await tokenFrom(
    await fetchImpl(`${baseUrl}/api/oauth/token`, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: jobber.get("code") ?? "",
        redirect_uri: redirectUri,
        client_id: "conformance",
        client_secret: "not-a-secret",
      }),
    }),
  );

  return {
    kind: "twin",
    fetch: fetchImpl,
    quickbooks: { apiBase: `${baseUrl}/v3`, realmId: qbo.get("realmId") ?? "", accessToken: qboToken },
    jobber: { apiUrl: `${baseUrl}/api/graphql`, accessToken: jobberToken },
    now: async () => {
      const advanced = await fetchImpl(`${baseUrl}/_twin/clock/advance`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ minutes: 1 / 60 }),
      });
      return ((await advanced.json()) as { twinTime: string }).twinTime;
    },
  };
}

/**
 * The real vendor sandboxes, from environment variables you set (never stored). Get the tokens however you
 * connect apps today, for example Intuit's OAuth 2.0 Playground and your Jobber app's OAuth flow.
 *
 *   QBO_ACCESS_TOKEN, QBO_REALM_ID   a sandbox company; QBO_API_BASE defaults to the sandbox base URL
 *   JOBBER_ACCESS_TOKEN              a Jobber developer testing account; JOBBER_API_URL defaults to the real API
 *
 * Only the vendors you give a token for are recorded.
 */
export const SANDBOX_DEFAULTS = {
  // "Use this base URL for sandbox companies": https://developer.intuit.com/app/developer/qbo/docs/develop/sandboxes/manage-your-sandboxes
  quickbooksApiBase: "https://sandbox-quickbooks.api.intuit.com/v3",
  jobberApiUrl: "https://api.getjobber.com/api/graphql",
};

export function sandboxTarget(env: NodeJS.ProcessEnv): { target: Target; vendors: ("quickbooks" | "jobber")[] } {
  const vendors: ("quickbooks" | "jobber")[] = [];
  if (env.QBO_ACCESS_TOKEN && env.QBO_REALM_ID) vendors.push("quickbooks");
  if (env.JOBBER_ACCESS_TOKEN) vendors.push("jobber");
  if (!vendors.length) {
    throw new Error(
      "Set QBO_ACCESS_TOKEN and QBO_REALM_ID (a QuickBooks sandbox company), JOBBER_ACCESS_TOKEN (a Jobber testing account), or both.",
    );
  }
  const quickbooksApiBase = env.QBO_API_BASE ?? SANDBOX_DEFAULTS.quickbooksApiBase;
  // Cases write test records. URL hostnames ignore case and anything before an @, so compare the parsed hostname.
  if (vendors.includes("quickbooks") && hostnameOf(quickbooksApiBase) === "quickbooks.api.intuit.com") {
    throw new Error("QBO_API_BASE points at production QuickBooks. Cases write test records: record against a sandbox company only.");
  }
  return {
    vendors,
    target: {
      kind: "sandbox",
      fetch: (url, init) => fetch(url, init),
      quickbooks: {
        apiBase: quickbooksApiBase,
        realmId: env.QBO_REALM_ID ?? "",
        accessToken: env.QBO_ACCESS_TOKEN ?? "",
      },
      jobber: { apiUrl: env.JOBBER_API_URL ?? SANDBOX_DEFAULTS.jobberApiUrl, accessToken: env.JOBBER_ACCESS_TOKEN ?? "" },
      now: async () => new Date().toISOString(),
    },
  };
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
