import type { ReactNode } from "react";

export function PageTitle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{children}</p>
    </div>
  );
}
