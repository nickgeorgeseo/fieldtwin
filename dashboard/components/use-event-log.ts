"use client";

import { useEffect, useState } from "react";
import { parseLog } from "@/lib/events.ts";
import { messageOf, twinLog } from "@/lib/twin-api.ts";
import type { TwinEvent } from "@/lib/twin-types.ts";
import { useTwin } from "./twin-provider.tsx";

/** The whole event log, read again whenever the twin's status says it may have changed (unless paused). */
export function useEventLog(paused = false): { events: TwinEvent[]; error: string | null } {
  const { logKey } = useTwin();
  const [events, setEvents] = useState<TwinEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paused || !logKey) return;
    let current = true;
    twinLog().then(
      (text) => {
        if (!current) return;
        setEvents(parseLog(text));
        setError(null);
      },
      (problem) => current && setError(messageOf(problem)),
    );
    return () => {
      current = false;
    };
  }, [logKey, paused]);

  return { events, error };
}
