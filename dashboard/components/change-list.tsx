import { summaryParts } from "@/lib/summaries.ts";
import { formatTwinTime } from "@/lib/twin-time.ts";
import { SourceBadge, VendorBadge } from "./ui.tsx";

/** The twin's one-line summaries of what happened, in columns: when, which vendor, what, and who did it. */
export function ChangeList({ summaries, utcOffsetHours, empty }: { summaries: string[]; utcOffsetHours: number; empty: string }) {
  if (summaries.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <ol className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
      {summaries.map((summary, index) => {
        const { at, vendor, what, source } = summaryParts(summary);
        return (
          // The same summary can happen twice (a webhook topic, say), so its place in the list is part of its key.
          // biome-ignore lint/suspicious/noArrayIndexKey: the list only grows at the end and is never reordered
          <li key={`${index}-${summary}`} className="flex items-center gap-3 py-1.5">
            <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-zinc-500">
              {at ? formatTwinTime(at, utcOffsetHours).time : ""}
            </span>
            {vendor && <VendorBadge vendor={vendor} />}
            <span className="min-w-0 flex-1 truncate font-mono text-xs" title={what}>
              {what}
            </span>
            {source && <SourceBadge source={source} />}
          </li>
        );
      })}
    </ol>
  );
}
