"use client";

import { useEffect, useRef, useState } from "react";
import { type FollowedLog, followLog, NOT_READ } from "@/lib/events.ts";
import { messageOf, twinLogAfter } from "@/lib/twin-api.ts";
import type { TwinEvent } from "@/lib/twin-types.ts";
import { useTwin } from "./twin-provider.tsx";

/**
 * The event log, read on from where this page left off each time the twin's status is read (unless paused). A read
 * asks only for what is new, so it can be that often, and a reset, rewind, or restart behind the page shows on the next.
 */
export function useEventLog(paused = false): { events: TwinEvent[]; error: string | null } {
  const { status } = useTwin();
  const [log, setLog] = useState<FollowedLog>(NOT_READ);
  const [error, setError] = useState<string | null>(null);
  const read = useRef(NOT_READ); // the log as of the last read, for the next one to go on from

  useEffect(() => {
    if (paused || !status) return;
    let current = true;
    followLog(read.current, twinLogAfter).then(
      (next) => {
        if (!current) return;
        read.current = next;
        setLog(next);
        setError(null);
      },
      (problem) => current && setError(messageOf(problem)),
    );
    return () => {
      current = false;
    };
  }, [status, paused]);

  return { events: log.events, error };
}
