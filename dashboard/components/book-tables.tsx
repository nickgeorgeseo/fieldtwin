import type { CustomerRow, InvoiceRow } from "@/lib/match-books.ts";
import { FIELD_SERVICES, type FieldService, vendorLabel } from "@/lib/vendors.ts";
import { customerStatuses, invoiceStatuses, money } from "./book-statuses.ts";
import { Badge } from "./ui.tsx";

const CELL = "px-3 py-2";
const MISSING = <span className="text-zinc-400">not there</span>;

function Head({ headings }: { headings: string[] }) {
  return (
    <thead className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800">
      <tr>
        {headings.map((heading) => (
          <th key={heading} className={`${CELL} font-medium`}>
            {heading}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function CustomerTable({ service, rows }: { service: FieldService; rows: CustomerRow[] }) {
  const name = vendorLabel(service);
  const { customer } = FIELD_SERVICES[service];
  const statuses = customerStatuses(name);
  return (
    <table className="w-full text-left text-sm">
      <Head headings={["Email", `${name} ${customer}`, "QuickBooks customer", ""]} />
      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((row) => {
          const { label, tone } = statuses[row.status];
          return (
            <tr key={`${row.email}-${row.field?.id}-${row.quickbooks?.id}`}>
              <td className={`${CELL} font-mono text-xs`}>{row.email || <span className="text-zinc-400">no email</span>}</td>
              <td className={CELL}>{row.field ? row.field.name : MISSING}</td>
              <td className={CELL}>
                {row.quickbooks ? (
                  <>
                    {row.quickbooks.name} <span className="font-mono text-xs text-zinc-400">Id {row.quickbooks.id}</span>
                  </>
                ) : (
                  MISSING
                )}
              </td>
              <td className={`${CELL} text-right`}>
                <Badge tone={tone}>{label}</Badge>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function InvoiceTable({ service, rows }: { service: FieldService; rows: InvoiceRow[] }) {
  const name = vendorLabel(service);
  const { customer } = FIELD_SERVICES[service];
  const statuses = invoiceStatuses(name);
  return (
    <table className="w-full text-left text-sm">
      <Head headings={["Number", `${name} ${customer}`, `${name} total`, name, "QuickBooks customer", "QuickBooks total", "Balance", ""]} />
      <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
        {rows.map((row) => {
          const { label, tone } = statuses[row.status];
          return (
            <tr key={`${row.number}-${row.quickbooks?.id}`}>
              <td className={`${CELL} font-mono text-xs`}>#{row.number}</td>
              <td className={CELL}>{row.field ? row.field.customer : MISSING}</td>
              <td className={CELL}>{money(row.field?.total)}</td>
              <td className={CELL}>{row.field && (row.field.paid ? <Badge tone="green">paid</Badge> : <Badge>open</Badge>)}</td>
              <td className={CELL}>{row.quickbooks ? row.quickbooks.customer : MISSING}</td>
              <td className={CELL}>{money(row.quickbooks?.total)}</td>
              <td className={CELL}>{money(row.quickbooks?.balance)}</td>
              <td className={`${CELL} text-right`}>
                <Badge tone={tone}>{label}</Badge>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
