import type { Answer } from "./case.ts";

/**
 * The answer, with the run's own credential replaced by `label` wherever the body repeats it: recordings are made from
 * answers and may hold no token or key, so a sandbox that echoes a header back loses it here, before any case sees it.
 */
export async function answerOf(response: Response, credential: string, label: string): Promise<Answer> {
  const body = parsed(await response.text());
  return { status: response.status, body: credential ? redacted(body, credential, label) : body };
}

// Every string in a parsed body, names included, with the credential replaced. The text can't be redacted instead: JSON
// may write the credential with escapes ("\/", or any character as \uXXXX), which only parsing turns back into it.
function redacted(value: Answer["body"], credential: string, label: string): Answer["body"] {
  if (typeof value === "string") return value.replaceAll(credential, label);
  if (Array.isArray(value)) return value.map((item) => redacted(item, credential, label));
  if (typeof value !== "object" || value === null) return value;
  const entries = Object.entries(value).map(([name, item]) => [name.replaceAll(credential, label), redacted(item, credential, label)]);
  return Object.fromEntries(entries);
}

function parsed(text: string): Answer["body"] {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
