import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setup } from "./helpers.ts";

/**
 * The README is the first thing a new user runs, so its examples are tested like code.
 * Every `curl` command in the Quick start is parsed and sent to a twin built with the default seed.
 */
const README = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
const quickStart = README.slice(README.indexOf("## Quick start"), README.indexOf("## Using it with your code"));

interface CurlRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

/** Just enough of curl's syntax for README examples: -X, -H, -d, and line continuations. */
function parseCurl(command: string): CurlRequest {
  const words = [...command.replace(/\\\n/g, " ").matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
  const request: CurlRequest = { method: "GET", path: "", headers: {} };
  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    if (word === "-X") request.method = words[++i]!;
    else if (word === "-H") {
      const [name, ...value] = words[++i]!.split(":");
      request.headers[name!.trim()] = value.join(":").trim();
    } else if (word === "-d") {
      request.body = words[++i];
      if (request.method === "GET") request.method = "POST";
    } else if (word.startsWith("http")) request.path = new URL(word).pathname + new URL(word).search;
  }
  return request;
}

const curlCommands = [...quickStart.matchAll(/```bash\n(curl[\s\S]*?)```/g)].map((match) => match[1]!.trim());

describe("the README quick start", () => {
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
    expect(body.errors ?? body.Fault).toBeUndefined();
  });
});
