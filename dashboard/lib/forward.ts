import { refusal } from "./request-guard.ts";

/**
 * Forward a dashboard request to the twin's control plane: /api/twin/clock/advance goes to /_twin/clock/advance.
 * Only /_twin is reachable this way. The vendor APIs stay out of reach on purpose: a dashboard reading through them
 * would spend their rate limits and draw from the seeded faults your own code meets.
 */

const METHODS = new Set(["GET", "POST", "PUT"]);

export interface ForwardOptions {
  twinUrl: string;
  fetch?: typeof fetch;
}

export async function forwardToTwin(request: Request, segments: string[], options: ForwardOptions): Promise<Response> {
  const refused = refusal(request);
  if (refused) return problem(403, refused);
  if (!METHODS.has(request.method)) return problem(405, `The control plane takes ${[...METHODS].join(", ")}, not ${request.method}.`);
  const path = controlPlanePath(segments);
  if (path === null) return problem(404, "That isn't a control-plane path.");

  const contentType = request.headers.get("content-type");
  const init: RequestInit = {
    method: request.method,
    headers: contentType ? { "content-type": contentType } : {},
    body: request.method === "GET" ? undefined : await request.text(),
    cache: "no-store",
  };
  let answer: Response;
  try {
    answer = await (options.fetch ?? fetch)(`${options.twinUrl}${path}${new URL(request.url).search}`, init);
  } catch {
    return problem(502, `Can't reach the twin at ${options.twinUrl}. Start it with npm start in the project folder, or set FIELDTWIN_URL.`);
  }
  return new Response(answer.body, {
    status: answer.status,
    headers: { "content-type": answer.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}

/** "/_twin/checkpoints/before%20agent" for ["checkpoints", "before agent"]; null for a segment that could climb out. */
export function controlPlanePath(segments: string[]): string | null {
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  return ["/_twin", ...segments.map(encodeURIComponent)].join("/");
}

function problem(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}
