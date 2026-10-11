/**
 * The twin's control plane has no authentication: whoever can send it a request can rewind it, change its faults,
 * or point its webhooks at any URL (SECURITY.md). The dashboard forwards to it, so it mustn't lend that to anyone
 * else. Two checks, both on headers a browser sets and a page can't:
 *
 *   Host    names this machine. A site that rebinds its DNS name to 127.0.0.1 still sends its own name.
 *   Origin  a change comes from the dashboard's own pages. Browsers send Origin with every POST and PUT, so a form
 *           or fetch from another site, or from another app on this machine, is refused.
 *
 * Reads need only the first: without CORS headers another site can send them, but never read the answer.
 */

const THIS_MACHINE = new Set(["localhost", "127.0.0.1", "[::1]"]);
const READS = new Set(["GET", "HEAD"]);

/** Why the dashboard won't forward this request, or null when it will. */
export function refusal(request: Request): string | null {
  const host = request.headers.get("host")?.toLowerCase() ?? "";
  if (!THIS_MACHINE.has(hostname(host))) {
    return `The dashboard only answers on this machine (localhost, 127.0.0.1, or [::1]), not as "${host}".`;
  }
  if (READS.has(request.method)) return null;
  if (originHost(request.headers.get("origin")) !== host) {
    return "Changes to the twin must come from the dashboard's own pages.";
  }
  return null;
}

/** "localhost" for "localhost:4020", "[::1]" for "[::1]:4020". */
function hostname(host: string): string {
  return /^(\[[^\]]*\]|[^:]*)(:\d+)?$/.exec(host)?.[1] ?? "";
}

/** "localhost:4020" for "http://localhost:4020"; null for a missing or opaque ("null") origin. */
function originHost(origin: string | null): string | null {
  if (!origin || origin === "null") return null;
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return null;
  }
}
