import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listScenarios } from "../src/control/operations.ts";
import { setup } from "./helpers.ts";

/**
 * The README is the first thing a new user runs, so its examples are tested like code: every `curl` in it is parsed
 * and sent to a twin built with the default seed, and the scenarios and settings it names must exist.
 */
const README = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
const quickStart = README.slice(README.indexOf("## Quick start"), README.indexOf("## Using it with your code"));

interface CurlRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

/** Just enough of curl's syntax for README examples: -X, -H, -d, -s, -o, -w, and line continuations. */
function parseCurl(command: string): CurlRequest {
  const words = [...command.replace(/\\\n/g, " ").matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
  const request: CurlRequest = { method: "GET", path: "", headers: {} };
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    if (word === "#") break; // a comment runs to the end of the line
    if (word === "-X") request.method = words[++i]!;
    else if (word === "-o" || word === "-w") i++;
    else if (word === "-H") {
      const [name, ...value] = words[++i]!.split(":");
      request.headers[name!.trim()] = value.join(":").trim();
    } else if (word === "-d") {
      request.body = words[++i];
      if (request.method === "GET") request.method = "POST";
    } else if (/^(https?:\/\/)?localhost:4010/.test(word)) {
      const url = new URL(word.startsWith("http") ? word : `http://${word}`);
      request.path = url.pathname + url.search;
    }
  }
  return request;
}

/** Every curl command in the bash blocks of `markdown`, in order. A block can hold several, and one can span lines. */
function curlsIn(markdown: string): string[] {
  return [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].flatMap((block) =>
    block[1]!
      .split(/^(?=curl )/m)
      .map((command) => command.trim())
      .filter((command) => command.startsWith("curl ")),
  );
}

describe("the README quick start", () => {
  const curlCommands = curlsIn(quickStart);

  it("shows the startup line the default seed really prints", () => {
    const { twin } = setup();
    expect(quickStart).toContain(`fieldtwin: ${twin.world.company.name} is open for business at http://localhost:4010`);
  });

  it("has curl examples to check", () => {
    expect(curlCommands.length).toBeGreaterThanOrEqual(2);
  });

  it.each(curlCommands.map((command) => [command.split("\n")[0], command]))("works as written: %s", async (_title, command) => {
    const { app } = setup();
    const request = parseCurl(command!);
    const response = await app.request(request.path, { method: request.method, headers: request.headers, body: request.body });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.errors ?? body.Fault ?? body.error).toBeUndefined(); // each vendor's error shape
  });
});

describe("the whole README", () => {
  it("has curl examples that all work as written, run in order against one twin", async () => {
    // Webhook deliveries are answered here: the README's subscriptions point at an app on localhost:3000.
    const { app } = setup(42, { sendWebhook: async () => new Response(null, { status: 200 }) });
    const commands = curlsIn(README).filter((command) => !command.includes("$")); // shell substitutions can't be replayed
    expect(commands.length).toBeGreaterThanOrEqual(8);
    for (const command of commands) {
      const request = parseCurl(command);
      const response = await app.request(request.path, { method: request.method, headers: request.headers, body: request.body });
      expect(response.status, `${command}\n${await response.clone().text()}`).toBeLessThan(400);
    }
  });

  it("names only scenarios that exist", () => {
    const scenarios = listScenarios().map((scenario) => scenario.name);
    const named = [
      ...README.matchAll(/npm start -- ([a-z-]+)(?=[\s`)])/g),
      ...README.matchAll(/^\| `([a-z-]+)` \| (?:A busy|Jobber and|Retry)/gm),
    ];
    expect(named.length).toBeGreaterThan(0);
    for (const [, name] of named) expect(scenarios, name).toContain(name);
  });

  it("documents every environment variable the server reads", () => {
    const server = readFileSync(join(import.meta.dirname, "..", "src", "server.ts"), "utf8");
    const variables = new Set(server.match(/FIELDTWIN_[A-Z]+/g));
    expect(variables.size).toBeGreaterThan(0);
    for (const variable of variables) expect(README, variable).toContain(`| \`${variable}\` |`);
  });
});
