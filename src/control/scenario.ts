import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { z } from "zod";
import { type FaultRule, isFaultStatus } from "../core/types.ts";

/**
 * A scenario is a YAML file describing a situation to test against: which world to generate, what time
 * it is, which faults are active, and a timeline of things that happen as twin time passes.
 * See "Scenario timelines" in ARCHITECTURE.md.
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

/** One timeline entry: when, and what each vendor should do then ({ jobber: { newClients: 15 } }). */
const TimelineEntrySchema = z
  .object({
    at: z.string(),
    quickbooks: z.record(z.unknown()).optional(),
    jobber: z.record(z.unknown()).optional(),
  })
  .strict();

const ScenarioSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  seed: z.number().int(),
  startTime: z.string(),
  world: z
    .object({
      customers: z.number().int().positive(),
      technicians: z.number().int().positive(),
      drift: z
        .object({
          renamedInAccounting: z.number().int().nonnegative(),
          fieldServiceOnly: z.number().int().nonnegative(),
          accountingOnly: z.number().int().nonnegative(),
        })
        .partial()
        .strict(),
    })
    .partial()
    .strict()
    .optional(),
  auth: z.enum(["any-token", "oauth"]).optional(),
  faults: z.array(FaultRuleSchema).default([]),
  timeline: z.array(TimelineEntrySchema).default([]),
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

/**
 * When a timeline entry happens, in epoch milliseconds. Three forms:
 *   "+90m", "+2h", "+1d"     after the scenario's start time
 *   "09:00"                  that time of day at the business, on the start date
 *   "2026-07-13T15:00:00Z"   an exact moment
 */
export function resolveAt(at: string, startMs: number, utcOffsetHours: number): number {
  const offset = /^\+(\d+(?:\.\d+)?)([mhd])$/.exec(at);
  if (offset) return startMs + Number(offset[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[offset[2] as "m" | "h" | "d"];

  const localTime = /^(\d{1,2}):(\d{2})$/.exec(at);
  if (localTime) {
    const localStart = new Date(startMs + utcOffsetHours * 3_600_000);
    const localMidnightUtc = Date.UTC(localStart.getUTCFullYear(), localStart.getUTCMonth(), localStart.getUTCDate());
    return localMidnightUtc + (Number(localTime[1]) - utcOffsetHours) * 3_600_000 + Number(localTime[2]) * 60_000;
  }

  const exact = /^\d{4}-\d{2}-\d{2}T/.test(at) ? Date.parse(at) : Number.NaN;
  if (!Number.isNaN(exact)) return exact;
  throw new Error(`Timeline time "${at}" isn't one the twin understands. Use "+2h", "09:00" (business time), or an ISO time.`);
}

/**
 * The ready-made scenarios in the project's scenarios/ folder. Found relative to this file, not the working
 * directory, because the MCP server can be started from anywhere.
 */
const SCENARIOS_DIR = new URL("../../scenarios/", import.meta.url);

export function listScenarioFiles(): { name: string; title: string; description: string }[] {
  return readdirSync(SCENARIOS_DIR)
    .filter((file) => file.endsWith(".yaml"))
    .sort()
    .map((file) => {
      const scenario = parseScenario(readFileSync(new URL(file, SCENARIOS_DIR), "utf8"));
      return { name: file.replace(/\.yaml$/, ""), title: scenario.name, description: (scenario.description ?? "").trim() };
    });
}

/** The YAML of a ready-made scenario, by name ("heat-wave-monday"). Names can't reach outside the folder. */
export function readScenarioFile(name: string): string {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`"${name}" isn't a scenario name. Names are lowercase words joined by dashes.`);
  const available = listScenarioFiles().map((scenario) => scenario.name);
  if (!available.includes(name)) throw new Error(`No scenario named "${name}". Available: ${available.join(", ")}`);
  return readFileSync(new URL(`${name}.yaml`, SCENARIOS_DIR), "utf8");
}
