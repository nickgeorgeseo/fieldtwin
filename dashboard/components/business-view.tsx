"use client";

import { type ReactNode, useMemo, useState } from "react";
import { readBooks } from "@/lib/books.ts";
import { matchCustomers, matchInvoices } from "@/lib/match-books.ts";
import { FIELD_SERVICES, type FieldService, vendorLabel } from "@/lib/vendors.ts";
import { customerStatuses, invoiceStatuses } from "./book-statuses.ts";
import { CustomerTable, InvoiceTable } from "./book-tables.tsx";
import { Badge, type BadgeTone, Button } from "./ui.tsx";
import { useEventLog } from "./use-event-log.ts";

type Tab = "customers" | "invoices";

/** A field-service system and QuickBooks side by side: the same business, as each system has it now. */
export function BusinessView() {
  const { events, error } = useEventLog();
  const [service, setService] = useState<FieldService>("jobber");
  const [tab, setTab] = useState<Tab>("customers");
  const [only, setOnly] = useState<string | null>(null);
  const books = useMemo(() => readBooks(events), [events]);
  const { customers, invoices } = useMemo(
    () => ({ customers: matchCustomers(books, service), invoices: matchInvoices(books, service) }),
    [books, service],
  );
  const name = vendorLabel(service);

  const show = (next: Tab, status: string | null) => {
    setTab(next);
    setOnly(status);
  };
  const rows = {
    customers: customers.filter((row) => !only || row.status === only),
    invoices: invoices.filter((row) => !only || row.status === only),
  };

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
      <fieldset className="flex flex-wrap items-center gap-2">
        {/* Floated, a legend lines up with the buttons as any flex item would. */}
        <legend className="float-left text-sm text-zinc-500 dark:text-zinc-400">Compare QuickBooks with</legend>
        {(Object.keys(FIELD_SERVICES) as FieldService[]).map((key) => (
          <Button
            key={key}
            tone={key === service ? "primary" : "secondary"}
            aria-pressed={key === service}
            onClick={() => {
              setService(key);
              setOnly(null);
            }}
          >
            {vendorLabel(key)}
          </Button>
        ))}
      </fieldset>
      <div className="grid gap-4 md:grid-cols-2">
        <Summary
          title="Customers, matched by email"
          total={customers.length}
          active={tab === "customers"}
          onAll={() => show("customers", null)}
        >
          {Object.entries(customerStatuses(name)).map(([status, { label, tone, help }]) => (
            <Count
              key={status}
              label={label}
              tone={tone}
              help={help}
              count={customers.filter((row) => row.status === status).length}
              selected={tab === "customers" && only === status}
              onClick={() => show("customers", status)}
            />
          ))}
        </Summary>
        <Summary
          title="Invoices, matched by number"
          total={invoices.length}
          active={tab === "invoices"}
          onAll={() => show("invoices", null)}
        >
          {Object.entries(invoiceStatuses(name)).map(([status, { label, tone, help }]) => (
            <Count
              key={status}
              label={label}
              tone={tone}
              help={help}
              count={invoices.filter((row) => row.status === status).length}
              selected={tab === "invoices" && only === status}
              onClick={() => show("invoices", status)}
            />
          ))}
        </Summary>
      </div>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        {tab === "customers" ? (
          <CustomerTable service={service} rows={rows.customers} />
        ) : (
          <InvoiceTable service={service} rows={rows.invoices} />
        )}
        {rows[tab].length === 0 && (
          <p className="p-6 text-center text-sm text-zinc-500">{events.length ? "None." : "Reading the twin's log…"}</p>
        )}
      </div>
    </div>
  );
}

function Summary(props: { title: string; total: number; active: boolean; onAll: () => void; children: ReactNode }) {
  return (
    <section
      className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-zinc-900 ${props.active ? "border-violet-400 dark:border-violet-700" : "border-zinc-200 dark:border-zinc-800"}`}
    >
      <button type="button" onClick={props.onAll} className="flex w-full items-baseline justify-between text-left">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">{props.title}</h2>
        <span className="text-2xl font-semibold tabular-nums">{props.total}</span>
      </button>
      <ul className="mt-3 space-y-1">{props.children}</ul>
    </section>
  );
}

function Count(props: { label: string; tone: BadgeTone; help: string; count: number; selected: boolean; onClick: () => void }) {
  if (props.count === 0) return null;
  return (
    <li>
      <button
        type="button"
        onClick={props.onClick}
        aria-pressed={props.selected}
        title={props.help}
        className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-sm ${props.selected ? "bg-zinc-100 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}
      >
        <Badge tone={props.tone}>{props.label}</Badge>
        <span className="tabular-nums">{props.count}</span>
      </button>
    </li>
  );
}
