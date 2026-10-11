import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/** The few building blocks every panel shares, so the pages read as one tool. */

export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      <header className="mb-4 flex min-h-7 items-center justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  );
}

const BUTTON_TONES = {
  primary: "bg-violet-600 text-white hover:bg-violet-500 disabled:bg-violet-300 dark:disabled:bg-violet-900",
  secondary:
    "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700",
  danger:
    "border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-zinc-800 dark:text-red-300 dark:hover:bg-red-950",
};

export function Button({
  tone = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof BUTTON_TONES }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${BUTTON_TONES[tone]} ${className}`}
      {...props}
    />
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm shadow-xs focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-950 ${className}`}
      {...props}
    />
  );
}

const BADGE_TONES = {
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  violet: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  green: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

/** Each vendor keeps one color everywhere: in badges, the event feed, and the business view. */
export function VendorBadge({ vendor }: { vendor: string }) {
  const known: Record<string, { tone: BadgeTone; label: string }> = {
    quickbooks: { tone: "green", label: "QuickBooks" },
    jobber: { tone: "sky", label: "Jobber" },
  };
  const { tone, label } = known[vendor] ?? { tone: "neutral" as const, label: vendor };
  return <Badge tone={tone}>{label}</Badge>;
}

/** Who made a change: your code through the APIs, the scenario's timeline, the control plane, or the seed. */
export function SourceBadge({ source }: { source: string }) {
  const known: Record<string, { tone: BadgeTone; label: string }> = {
    api: { tone: "violet", label: "your code" },
    scenario: { tone: "amber", label: "scenario" },
    control: { tone: "sky", label: "control" },
    seed: { tone: "neutral", label: "seed" },
  };
  const { tone, label } = known[source] ?? { tone: "neutral" as const, label: source };
  return <Badge tone={tone}>{label}</Badge>;
}

export interface Notice {
  ok: boolean;
  text: string;
}

/** What the last action did, or why the twin refused it, in its own words. */
export function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p
      role={notice.ok ? "status" : "alert"}
      className={`mt-3 text-sm ${notice.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
    >
      {notice.text}
    </p>
  );
}

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}
