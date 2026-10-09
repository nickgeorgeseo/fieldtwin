import { parse } from "yaml";
import { z } from "zod";

/**
 * A scenario is a YAML file describing a situation to test against:
 * which world to generate, what time it is, and which faults are active.
 * (Timelines of scripted events, like "40 new requests arrive by 9am", come next. See ARCHITECTURE.md.)
 */
const FaultRuleSchema = z.object({
  name: z.string(),
  vendor: z.enum(["quickbooks", "jobber"]),
  method: z.string().optional(),
  pathIncludes: z.string().optional(),
  rate: z.number().min(0).max(1),
  effect: z.object({
    status: z.number().int().optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    message: z.string().optional(),
  }),
});

const ScenarioSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  seed: z.number().int(),
  startTime: z.string(),
  world: z.object({ customers: z.number().int().positive(), technicians: z.number().int().positive() }).partial().optional(),
  faults: z.array(FaultRuleSchema).default([]),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

/** Parse and validate a scenario. Errors name the exact field that is wrong. */
export function parseScenario(yamlText: string): Scenario {
  return ScenarioSchema.parse(parse(yamlText));
}
