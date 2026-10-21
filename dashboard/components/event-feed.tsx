"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type EventFilter, filterEvents } from "@/lib/events.ts";
import { VENDOR_LABELS } from "@/lib/vendors.ts";
import { EventRow } from "./event-row.tsx";
import { useTwin } from "./twin-provider.tsx";
import { Button, TextInput } from "./ui.tsx";
import { useEventLog } from "./use-event-log.ts";

const VENDORS = [{ vendor: "", label: "All vendors" }, ...Object.entries(VENDOR_LABELS).map(([vendor, label]) => ({ vendor, label }))];
const SOURCES = [
  { source: "api", label: "Your code" },
  { source: "scenario", label: "Scenario" },
  { source: "control", label: "Control" },
  { source: "seed", label: "Seed" },
];
const PAGE = 200;

/** The event log as it grows, newest first. */
export function EventFeed() {
  const { status } = useTwin();
  const [paused, setPaused] = useState(false);
  const { events, error } = useEventLog(paused);
  const [filter, setFilter] = useState<EventFilter>({ vendor: "", sources: ["api", "scenario", "control"], search: "" });
  const [shown, setShown] = useState(PAGE);
  const [freshAfter, setFreshAfter] = useState(Number.POSITIVE_INFINITY);
  const newestRead = useRef(0);

  // Mark what arrived since the last read. After a rewind or reset nothing is new.
  useEffect(() => {
    const newest = events.at(-1)?.seq ?? 0;
    setFreshAfter(newestRead.current && newest > newestRead.current ? newestRead.current : Number.POSITIVE_INFINITY);
    newestRead.current = newest;
  }, [events]);

  const visible = useMemo(() => filterEvents(events, filter).reverse(), [events, filter]);
  const counts = useMemo(
    () => Object.fromEntries(SOURCES.map(({ source }) => [source, events.filter((event) => event.source === source).length])),
    [events],
  );
  const toggle = (source: string) =>
    setFilter({
      ...filter,
      sources: filter.sources.includes(source) ? filter.sources.filter((kept) => kept !== source) : [...filter.sources, source],
    });

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="sticky top-[57px] z-[5] flex flex-wrap items-center gap-2 rounded-t-xl border-b border-zinc-200 bg-white/95 p-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <select
          aria-label="Vendor"
          value={filter.vendor}
          onChange={(event) => setFilter({ ...filter, vendor: event.target.value })}
          className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          {VENDORS.map(({ vendor, label }) => (
            <option key={vendor} value={vendor}>
              {label}
            </option>
          ))}
        </select>
        {SOURCES.map(({ source, label }) => (
          <label
            key={source}
            className="flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs dark:border-zinc-700"
          >
            <input
              type="checkbox"
              checked={filter.sources.includes(source)}
              onChange={() => toggle(source)}
              className="accent-violet-600"
            />
            {label} <span className="tabular-nums text-zinc-500">{counts[source]}</span>
          </label>
        ))}
        <TextInput
          type="search"
          aria-label="Search events"
          placeholder="Search: a name, an Id, a type…"
          value={filter.search}
          onChange={(event) => setFilter({ ...filter, search: event.target.value })}
          className="min-w-48 flex-1"
        />
        <Button aria-pressed={paused} onClick={() => setPaused(!paused)}>
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>
      {error && <p className="p-3 text-sm text-red-700 dark:text-red-400">{error}</p>}
      <p className="px-3 pt-2 text-xs text-zinc-500">
        {visible.length.toLocaleString("en-US")} of {events.length.toLocaleString("en-US")} events{paused ? ", paused" : ", live"}
      </p>
      <ol className="divide-y divide-zinc-100 py-1 dark:divide-zinc-800">
        {visible.slice(0, shown).map((event) => (
          <EventRow key={event.seq} event={event} utcOffsetHours={status?.company.utcOffsetHours ?? 0} fresh={event.seq > freshAfter} />
        ))}
      </ol>
      {visible.length > shown && (
        <div className="border-t border-zinc-100 p-3 text-center dark:border-zinc-800">
          <Button onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more</Button>
        </div>
      )}
      {visible.length === 0 && events.length > 0 && (
        <p className="p-6 text-center text-sm text-zinc-500">No events match. Try the Seed box, or another search.</p>
      )}
    </div>
  );
}
