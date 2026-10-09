import type { VendorTwin } from "../../core/vendor-twin.ts";
import { describeJobberEvent } from "./events.ts";
import { graphQLError, jobberRoutes } from "./routes.ts";
import { jobberScenarioActions } from "./scenario-actions.ts";
import { seedJobber } from "./seed.ts";
import { applyJobberEvent, createJobberState } from "./state.ts";
import type { JobberState } from "./types.ts";

export const jobberTwin: VendorTwin<JobberState> = {
  name: "jobber",
  pathPrefix: "/api",
  createState: createJobberState,
  apply: applyJobberEvent,
  describeEvent: describeJobberEvent,
  seed: seedJobber,
  routes: jobberRoutes,
  // Jobber's DDoS guard answers 429 with a plain HTTP error; other injected faults use GraphQL's error shape.
  scenarioActions: jobberScenarioActions,
  errorBody: (status, message) => (status === 429 ? { message: "Too Many Requests" } : graphQLError(message, "INJECTED_FAULT")),
};
