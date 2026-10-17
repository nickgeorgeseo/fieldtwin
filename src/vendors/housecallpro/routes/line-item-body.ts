import { isObject } from "../../../core/request-body.ts";
import type { HcpLineItem } from "../types/index.ts";

/**
 * Reading the line items a client sends (the reference's LineItemCreate and JobLineItemCreate). `name` is required.
 * Prices are whole cents: "Selling price of a single unit in cents", 0 unless sent. `quantity` "can be a float up to
 * two decimal places", 1 unless sent. A line is `labor` and taxable unless the request says otherwise, the defaults
 * JobLineItemCreate documents.
 */
export type LineFields = Omit<HcpLineItem, "id">;

/** Something the twin can't take: what's wrong, and whether it is the request (422) or the twin (501). */
export type Refusal = { status: 422 | 501; problem: string };

export function readLineItems(value: unknown): LineFields[] | Refusal {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return refuse(`line_items must be a list of line items, not ${JSON.stringify(value)}.`);
  const lines: LineFields[] = [];
  for (const [index, entry] of value.entries()) {
    const line = readLineItem(entry, `line_items[${index}]`);
    if ("problem" in line) return line;
    lines.push(line);
  }
  return lines;
}

function readLineItem(value: unknown, path: string): LineFields | Refusal {
  if (!isObject(value)) return refuse(`${path} must be a line item, like {"name": "Service call", "unit_price": 8900}.`);
  if (value.pricing_form !== undefined) return { status: 501, problem: `${path}.pricing_form: the twin doesn't model price forms yet.` };
  const { name, description = null, unit_price = 0, unit_cost = 0, quantity = 1, kind = "labor", taxable = true } = value;
  if (typeof name !== "string" || !name.trim()) return refuse(`${path}.name is required: a line item needs a name.`);
  if (description !== null && typeof description !== "string") return refuse(`${path}.description must be a string or null.`);
  for (const [field, cents] of [
    ["unit_price", unit_price],
    ["unit_cost", unit_cost],
  ] as const) {
    if (!Number.isInteger(cents) || (cents as number) < 0) {
      return refuse(`${path}.${field} must be whole cents of 0 or more, like 8900 for $89.00, not ${JSON.stringify(cents)}.`);
    }
  }
  if (typeof quantity !== "number" || quantity < 0 || Math.abs(quantity * 100 - Math.round(quantity * 100)) > 1e-9) {
    return refuse(`${path}.quantity must be a number of 0 or more, with up to two decimal places, not ${JSON.stringify(quantity)}.`);
  }
  if (!KINDS.includes(kind as string)) return refuse(`${path}.kind must be one of ${KINDS.join(", ")}, not ${JSON.stringify(kind)}.`);
  if (kind !== "labor" && kind !== "materials") {
    return { status: 501, problem: `${path}.kind: the twin doesn't model ${kind} lines yet, only labor and materials.` };
  }
  if (typeof taxable !== "boolean") return refuse(`${path}.taxable must be true or false.`);
  return { name, description, unit_price: unit_price as number, unit_cost: unit_cost as number, quantity, kind, taxable };
}

const KINDS = ["materials", "labor", "fixed gratuity", "fixed discount", "percent discount"];

export function refuse(problem: string): Refusal {
  return { status: 422, problem };
}
