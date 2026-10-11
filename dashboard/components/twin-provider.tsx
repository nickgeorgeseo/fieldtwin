"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { messageOf, twinGet } from "@/lib/twin-api.ts";
import type { TwinStatus } from "@/lib/twin-types.ts";

/**
 * The twin's status (GET /_twin), read every POLL_MS and after every change the dashboard makes, shared by every
 * page. `logKey` changes whenever the log may have: pages that read the whole log refetch only then.
 */

const POLL_MS = 1500;

interface TwinState {
  status: TwinStatus | null;
  error: string | null;
  logKey: string;
  refresh: () => Promise<void>;
}

const TwinContext = createContext<TwinState | null>(null);

export function TwinProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TwinStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reading = useRef(false);

  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    try {
      setStatus(await twinGet<TwinStatus>());
      setError(null);
    } catch (problem) {
      setError(messageOf(problem));
    } finally {
      reading.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const logKey = status ? `${status.seed}|${status.scenario}|${status.eventCount}|${status.twinTime}` : "";
  return <TwinContext value={{ status, error, logKey, refresh }}>{children}</TwinContext>;
}

export function useTwin(): TwinState {
  const state = useContext(TwinContext);
  if (!state) throw new Error("useTwin needs a TwinProvider above it (app/layout.tsx has one).");
  return state;
}
