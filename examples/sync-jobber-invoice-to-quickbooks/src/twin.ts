import type { Endpoints } from "./endpoints.ts";
import { exchangeCode, type Tokens, type VendorOAuth } from "./oauth.ts";
import type { Fetch, Runtime } from "./runtime.ts";

/**
 * Twin-only plumbing for the demo and the tests. Production code doesn't use this file.
 *
 * Connecting without a browser: in production a person approves the connection on the vendor's consent page,
 * and the vendor redirects to your callback URL with ?code=. The twin approves every authorization request at
 * once, so reading the code from the redirect's Location header stands in for both the person and the callback.
 *
 * A twin runtime: sleeping advances twin time over the control plane (POST /_twin/clock/advance), so a
 * 60-second backoff costs no real time, and now() follows the twin's clock, which is what tokens expire on.
 */

const REDIRECT_URI = "http://localhost:3000/oauth/callback"; // never visited: the twin hands back the code directly
const QUICKBOOKS_SCOPE = "com.intuit.quickbooks.accounting";

export async function connectWithoutBrowser(
  vendor: "quickbooks" | "jobber",
  endpoints: Endpoints,
  oauth: VendorOAuth,
  runtime: Runtime,
): Promise<{ tokens: Tokens; realmId?: string }> {
  const state = `connect-${vendor}`; // in production: a random value tied to the user's session, checked on the way back
  const authorize = new URL(endpoints[vendor].authorizeUrl);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: oauth.clientId,
    redirect_uri: REDIRECT_URI,
    state,
    ...(vendor === "quickbooks" && { scope: QUICKBOOKS_SCOPE }),
  }).toString();

  const response = await runtime.fetch(authorize.toString(), { redirect: "manual" });
  const location = response.headers.get("Location");
  if (response.status !== 302 || !location) {
    throw new Error(`Expected ${vendor}'s authorize endpoint to redirect with a code; it answered HTTP ${response.status}.`);
  }
  const callback = new URL(location).searchParams;
  const code = callback.get("code");
  if (callback.get("state") !== state) throw new Error(`The ${vendor} redirect came back with the wrong state.`);
  if (!code) throw new Error(`${vendor} refused the connection: ${callback.get("error") ?? "no code in the redirect"}.`);

  const tokens = await exchangeCode(oauth, code, REDIRECT_URI, runtime);
  return { tokens, realmId: callback.get("realmId") ?? undefined }; // QuickBooks names the company it connected
}

/**
 * A Runtime for a twin running at baseUrl. now() starts at the twin's time and moves when sleep() moves the
 * twin, so it stays right as long as nothing else advances the twin's clock while the demo runs.
 */
export async function twinRuntime(baseUrl: string, log: (line: string) => void, fetchImpl: Fetch = (url, init) => fetch(url, init)) {
  const twinTime = async (response: Response) => Date.parse(((await response.json()) as { twinTime: string }).twinTime);
  let nowMs = await twinTime(await fetchImpl(`${baseUrl}/_twin`));
  const runtime: Runtime = {
    fetch: fetchImpl,
    now: () => nowMs,
    random: () => Math.random(),
    log,
    sleep: async (milliseconds) => {
      const body = JSON.stringify({ minutes: milliseconds / 60_000 });
      nowMs = await twinTime(
        await fetchImpl(`${baseUrl}/_twin/clock/advance`, { method: "POST", body, headers: { "Content-Type": "application/json" } }),
      );
    },
  };
  return runtime;
}
