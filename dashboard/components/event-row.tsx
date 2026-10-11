import { describeEvent } from "@/lib/events.ts";
import { formatTwinTime } from "@/lib/twin-time.ts";
import type { TwinEvent } from "@/lib/twin-types.ts";
import { SourceBadge, VendorBadge } from "./ui.tsx";

/** One event: a line to scan, and the whole record it carries when opened. */
export function EventRow({ event, utcOffsetHours, fresh }: { event: TwinEvent; utcOffsetHours: number; fresh: boolean }) {
  const time = formatTwinTime(event.at, utcOffsetHours);
  return (
    <li className={`transition-colors ${fresh ? "bg-violet-50 dark:bg-violet-950/40" : ""}`}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
          <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-400">{event.seq}</span>
          <span
            className="w-32 shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500"
            title={`${time.day} ${time.time} (${event.at})`}
          >
            {time.day.split(", ")[1]} {time.time}
          </span>
          <VendorBadge vendor={event.vendor} />
          <span className="shrink-0 font-mono text-xs font-semibold">{event.type}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600 dark:text-zinc-400">{describeEvent(event)}</span>
          <SourceBadge source={event.source} />
        </summary>
        <pre className="mx-3 mb-2 max-h-96 overflow-auto rounded-md bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-950">
          {JSON.stringify(event.data, null, 2)}
        </pre>
      </details>
    </li>
  );
}
