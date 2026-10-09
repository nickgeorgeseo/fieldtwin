import { parse } from "yaml";
import { z } from "zod";
import { type FaultRule, isFaultStatus } from "../core/types.ts";

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
    status: z.number().refine(isFaultStatus, { message: "must be an HTTP error status, like 429 or 503" }).optional(),
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
  auth: z.enum(["any-token", "oauth"]).optional(),
  faults: z.array(FaultRuleSchema).default([]),
});

export type Scenario = z.infer<typeof ScenarioSchema>;

/** Parse and validate a scenario. Errors name the exact field that is wrong. */
export function parseScenario(yamlText: string): Scenario {
  return validate(ScenarioSchema, parse(yamlText), "Invalid scenario");
}

/** Validate fault rules from any source (a scenario, the control plane, an MCP tool) before they take effect. */
export function parseFaultRules(value: unknown): FaultRule[] {
  return validate(z.array(FaultRuleSchema), value, "Invalid fault rules");
}

function validate<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`${what}. ${problems.join("; ")}`);
}
