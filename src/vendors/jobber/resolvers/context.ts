import type { JobberState } from "../types.ts";
import type { Lookups } from "./lookups.ts";

/** What every resolver can see: the current state and the twin's clock. Only mutations.ts records changes. */
export interface ResolverContext {
  state: () => JobberState;
  nowMs: () => number;
  lookups: () => Lookups; // which records belong to which, for the state as it is now (lookups.ts)
}
