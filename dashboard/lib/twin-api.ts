import { parseLog } from "./events.ts";
import type { Read } from "./follow.ts";
import type { Change, TwinEvent } from "./twin-types.ts";

/** The browser's calls to the twin's control plane, through the dashboard's /api/twin (lib/forward.ts). */

const BASE = "/api/twin";

export async function twinGet<T>(path = ""): Promise<T> {
  return readAnswer<T>(await fetch(`${BASE}${path}`, { cache: "no-store" }));
}

/** The event log after a position an earlier read gave (all of it for null). See follow.ts. */
export async function twinLogAfter(position: string | null): Promise<Read<TwinEvent>> {
  const query = position ? `?after=${encodeURIComponent(position)}` : "";
  return readFollowed(await fetch(`${BASE}/log.jsonl${query}`, { cache: "no-store" }), parseLog);
}

/** What changed since a checkpoint (`path`, like "/checkpoints/before"), all of it or one source's, after a position. */
export async function twinChangesAfter(path: string, source: string, position: string | null): Promise<Read<Change>> {
  const query = new URLSearchParams({ ...(source && { source }), ...(position && { after: position }) }).toString();
  return readFollowed(await fetch(`${BASE}${path}/changes${query && `?${query}`}`, { cache: "no-store" }), JSON.parse);
}

/** What a read of a followed list holds, and where the log ends; or "changed" when it has changed since the position asked after. */
export async function readFollowed<T>(response: Response, parse: (text: string) => T[]): Promise<Read<T>> {
  if (response.status === 409) return "changed";
  const text = await readAnswer(response, "text");
  return { items: parse(text), position: response.headers.get("x-twin-log-position") };
}

/** A change to the twin. `body` goes as JSON; a string with `contentType` (a scenario's YAML) goes as it is. */
export async function twinSend<T>(method: "POST" | "PUT", path: string, body?: unknown, contentType = "application/json"): Promise<T> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": contentType };
    init.body = contentType === "application/json" ? JSON.stringify(body) : String(body);
  }
  return readAnswer<T>(await fetch(`${BASE}${path}`, init));
}

/** An answer's JSON (or text, for the log), or an error in the twin's own words when it refused. */
export async function readAnswer<T = unknown>(response: Response, as?: "json"): Promise<T>;
export async function readAnswer(response: Response, as: "text"): Promise<string>;
export async function readAnswer(response: Response, as: "json" | "text" = "json"): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new Error(errorIn(text) ?? `The twin answered HTTP ${response.status}.`);
  return as === "text" ? text : JSON.parse(text);
}

function errorIn(text: string): string | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && "error" in value && typeof value.error === "string" ? value.error : null;
  } catch {
    return null;
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
