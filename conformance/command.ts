/**
 * What `npm run conformance` and `npm run conformance:record` were asked to do. `npm run conformance:record
 * --dry-run`, without the `--` npm needs to pass a flag on, reaches the script only as npm_config_dry_run: read as
 * a dry run all the same, since getting it wrong would overwrite the recordings.
 */
export type Command = { command: "score" } | { command: "record"; dryRun: boolean };

const USAGE = "Use score (npm run conformance) or record (npm run conformance:record, with --dry-run to only print).";

export function parseCommand(args: string[], env: NodeJS.ProcessEnv): Command {
  const [command = "score", ...flags] = args;
  const unknown = flags.filter((flag) => flag !== "--dry-run");
  if (unknown.length) throw new Error(`unknown option ${unknown.join(" ")}. ${USAGE}`);
  if (command === "score") {
    if (flags.length) throw new Error(`--dry-run is for record: score never saves anything. ${USAGE}`);
    return { command };
  }
  if (command === "record") return { command, dryRun: flags.includes("--dry-run") || env.npm_config_dry_run === "true" };
  throw new Error(`unknown command "${command}". ${USAGE}`);
}
