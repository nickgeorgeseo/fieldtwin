import type { JobberState } from "../types.ts";

/** What every resolver can see: the current state and the twin's clock. Only mutations.ts records changes. */
export interface ResolverContext {
  state: () => JobberState;
  nowMs: () => number;
}
