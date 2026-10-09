import type { JobberState } from "../types.ts";

/** What every resolver can see: the current state and the twin's clock. Resolvers never change state. */
export interface ResolverContext {
  state: () => JobberState;
  nowMs: () => number;
}
