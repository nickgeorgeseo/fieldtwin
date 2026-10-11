"use client";

import { useState } from "react";
import { messageOf } from "@/lib/twin-api.ts";
import { useTwin } from "./twin-provider.tsx";
import type { Notice } from "./ui.tsx";

/**
 * Run one change to the twin from a panel: busy while it runs, then a notice saying what it did (the string
 * `work` returns) or why the twin refused, and a fresh status either way.
 */
export function useAction() {
  const { refresh } = useTwin();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function run(work: () => Promise<string>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice({ ok: true, text: await work() });
    } catch (problem) {
      setNotice({ ok: false, text: messageOf(problem) });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  return { busy, notice, run };
}
