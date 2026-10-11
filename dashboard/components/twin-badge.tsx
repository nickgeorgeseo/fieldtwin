"use client";

import { formatTwinTime } from "@/lib/twin-time.ts";
import { useTwin } from "./twin-provider.tsx";

/** The header's one-line answer to "is the twin there, and what time is it there?" */
export function TwinBadge() {
  const { status, error } = useTwin();
  const connected = status !== null && error === null;
  const time = status && formatTwinTime(status.twinTime, status.company.utcOffsetHours);
  return (
    <div className="ml-auto flex items-center gap-2 text-sm">
      <span className={`size-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} aria-hidden="true" />
      {connected && status && time ? (
        <span className="text-zinc-600 dark:text-zinc-300">
          {status.company.name} · <span className="font-mono tabular-nums">{time.time}</span> {time.day.split(",")[0]} ({time.zone})
        </span>
      ) : (
        <span className="text-zinc-500">{status ? "Lost the twin" : "Looking for the twin…"}</span>
      )}
    </div>
  );
}

/** Shown on every page while the twin can't be reached, with how to start it. */
export function OfflineBanner() {
  const { error } = useTwin();
  if (!error) return null;
  return (
    <div
      role="alert"
      className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      {error}
    </div>
  );
}
