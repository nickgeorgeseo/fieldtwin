import { isObject, shown } from "../../../core/request-body.ts";
import { lineAmount } from "../amounts.ts";
import type { HcpLineItem } from "../types/index.ts";
import { type Refusal, refuse, withoutNulls } from "./body.ts";

/**
 * Reading the line items a client sends (the reference's LineItemCreate and JobLineItemCreate). `name` is required.
 * Prices are whole cents: "Selling price of a single unit in cents", 0 unless sent. `quantity` "can be a float up to
 * two decimal places", 1 unless sent. A line is `labor` and taxable unless the request says otherwise, the defaults
 * JobLineItemCreate documents. Every amount must come to whole cents a number can count exactly (up to 2^53), so a
 * total is never rounded, or answered as null.
 */
export type LineFields = Omit<HcpLineItem, "id">;

export function readLineItems(value: unknown): LineFields[] | Refusal {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return refuse(`line_items must be a list of line items, not ${shown(value)}.`);
  const lines: LineFields[] = [];
  for (const [index, entry] of value.entries()) {
    const line = readLineItem(entry, `line_items[${index}]`);
    if ("problem" in line) return line;
    lines.push(line);
  }
  if (!Number.isSafeInteger(lines.reduce((total, line) => total + lineAmount(line), 0))) {
    return refuse("line_items come to more cents, together, than the twin can count exactly. No real job is that big.");
  }
  return lines;
}

function readLineItem(value: unknown, path: string): LineFields | Refusal {
  if (!isObject(value)) return refuse(`${path} must be a line item, like {"name": "Service call", "unit_price": 8900}.`);
  if (value.pricing_form != null) return refuse(`${path}.pricing_form: the twin doesn't model price forms yet.`, 501);
  const fields = withoutNulls(value); // a field sent as null takes its default, as one not sent does
  const { name, description = null, unit_price = 0, unit_cost = 0, quantity = 1, kind = "labor", taxable = true } = fields;
  if (typeof name !== "string" || !name.trim()) return refuse(`${path}.name is required: a line item needs a name.`);
  if (description !== null && typeof description !== "string") return refuse(`${path}.description must be a string or null.`);
  for (const [field, cents] of [
    ["unit_price", unit_price],
    ["unit_cost", unit_cost],
  ] as const) {
    if (!Number.isSafeInteger(cents) || (cents as number) < 0) {
      return refuse(`${path}.${field} must be whole cents of 0 or more, like 8900 for $89.00, not ${shown(cents)}.`);
    }
  }
  if (
    typeof quantity !== "number" ||
    !Number.isFinite(quantity) ||
    quantity < 0 ||
    Math.round(quantity * 100) / 100 !== quantity // two decimal places, however large: 1234567.89 is, 1.125 isn't
  ) {
    return refuse(`${path}.quantity must be a number of 0 or more, with up to two decimal places, not ${shown(quantity)}.`);
  }
  // lineAmount multiplies hundredths of the quantity by the price, so that product has to stay exact too.
  if (!Number.isSafeInteger(Math.round(quantity * 100) * (unit_price as number))) {
    return refuse(`${path}: quantity times unit_price comes to more cents than the twin can count exactly. No real line is that big.`);
  }
  if (!KINDS.includes(kind as string)) return refuse(`${path}.kind must be one of ${KINDS.join(", ")}, not ${shown(kind)}.`);
  if (kind !== "labor" && kind !== "materials") {
    return refuse(`${path}.kind: the twin doesn't model ${kind} lines yet, only labor and materials.`, 501);
  }
  if (typeof taxable !== "boolean") return refuse(`${path}.taxable must be true or false.`);
  return { name, description, unit_price: unit_price as number, unit_cost: unit_cost as number, quantity, kind, taxable };
}

const KINDS = ["materials", "labor", "fixed gratuity", "fixed discount", "percent discount"];
