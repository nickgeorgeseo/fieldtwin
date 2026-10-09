import type { Hono } from "hono";
import type { World } from "../world/generate-world.ts";
import type { Twin } from "./twin.ts";
import type { NewEvent, TwinEvent, VendorName } from "./types.ts";

/**
 * The contract every vendor twin implements. Adding a vendor means adding one folder
 * under src/vendors/ that exports an object of this shape, then listing it in src/app.ts.
 *
 * Vendor folders never import from each other. Anything two vendors share belongs in core/ or world/.
 */
export interface VendorTwin<State = unknown> {
  name: VendorName;

  /** URL prefix this vendor's real API lives under, e.g. "/v3". Two vendors may not share one. */
  pathPrefix: string;

  /** A fresh, empty state object. */
  createState(): State;

  /**
   * Update state for one event. This is the ONLY place vendor state changes,
   * and it must be deterministic: same events in, same state out.
   */
  apply(state: State, event: TwinEvent): void;

  /** Turn the shared fake business into this vendor's starting records. */
  seed(world: World): NewEvent[];

  /** HTTP routes shaped like the vendor's real API, mounted at the server root. */
  routes(twin: Twin): Hono;

  /** An error body in the vendor's own format, so injected faults look real. */
  errorBody(status: number, message: string, twin: Twin): unknown;
}
