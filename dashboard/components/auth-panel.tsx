"use client";

import { twinSend } from "@/lib/twin-api.ts";
import type { AuthMode } from "@/lib/twin-types.ts";
import { useTwin } from "./twin-provider.tsx";
import { Card, NoticeLine } from "./ui.tsx";
import { useAction } from "./use-action.ts";

const MODES: { mode: AuthMode; label: string; help: string }[] = [
  { mode: "any-token", label: "Any token", help: "Any bearer token works. Quick, and the wrong setting for testing OAuth code." },
  { mode: "oauth", label: "Real OAuth", help: "Only unexpired tokens from the twin's OAuth servers, as the real APIs check." },
];

/** How the vendor APIs treat bearer tokens (PUT /_twin/auth). */
export function AuthPanel() {
  const { status } = useTwin();
  const { busy, notice, run } = useAction();
  return (
    <Card title="Auth">
      <fieldset disabled={busy || !status} className="grid gap-2">
        <legend className="sr-only">Auth mode</legend>
        {MODES.map(({ mode, label, help }) => (
          <label
            key={mode}
            className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
              status?.authMode === mode
                ? "border-violet-500 bg-violet-50 dark:border-violet-400 dark:bg-violet-950/40"
                : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
            }`}
          >
            <input
              type="radio"
              name="auth-mode"
              value={mode}
              checked={status?.authMode === mode}
              onChange={() =>
                run(async () => `Auth is now ${(await twinSend<{ authMode: AuthMode }>("PUT", "/auth", { mode })).authMode}.`)
              }
              className="mt-1 accent-violet-600"
            />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <NoticeLine notice={notice} />
    </Card>
  );
}
