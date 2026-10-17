/**
 * Paging and sorting, the way Housecall Pro's lists do it: `page` counts from 1, `page_size` is 10 unless asked, and
 * the answer carries `page`, `page_size`, `total_pages`, and `total_items` (the reference's PaginatedList) beside the
 * records. `sort_direction` is `desc` unless asked, so the newest come first.
 * https://docs.housecallpro.com/docs/housecall-public-api/042bd3bf861ae-get-customers
 */

/** The part of a request lists read: its query string. Hono's `c.req` is one. */
export interface ListRequest {
  query(name: string): string | undefined;
  queries(name: string): string[] | undefined;
}

export interface ListQuery<Key extends string> {
  paging: Paging;
  sort: Sort<Key>;
  expand: Set<string>;
}

/** Everything a list request asks for, or the first thing wrong with it. */
export function readList<Key extends string>(
  req: ListRequest,
  options: { sortable: readonly Key[]; sortBy: Key; expandable: readonly string[] },
): ListQuery<Key> | { problem: string } {
  const paging = readPaging(req);
  if ("problem" in paging) return paging;
  const sort = readSort(req, options.sortable, options.sortBy);
  if ("problem" in sort) return sort;
  const expand = readExpand(req, options.expandable);
  if ("problem" in expand) return expand;
  return { paging, sort, expand };
}

export interface Paging {
  page: number;
  page_size: number;
}

/**
 * The page asked for, or what's wrong with it. The docs give no largest page_size, so the twin sets none (FIDELITY.md).
 * A page below 1 is refused rather than read as the first: code that counts pages from 0 would otherwise read page 1
 * twice.
 */
export function readPaging(req: ListRequest): Paging | { problem: string } {
  const page = wholeNumber(req.query("page"), 1);
  const pageSize = wholeNumber(req.query("page_size"), 10);
  if (page === undefined) return { problem: `page must be a whole number of 1 or more, not "${req.query("page")}". Pages count from 1.` };
  if (pageSize === undefined) return { problem: `page_size must be a whole number of 1 or more, not "${req.query("page_size")}".` };
  return { page, page_size: pageSize };
}

function wholeNumber(text: string | undefined, fallback: number): number | undefined {
  if (text === undefined || text === "") return fallback;
  return /^\d+$/.test(text) && Number(text) >= 1 ? Number(text) : undefined;
}

/** One page of `records`, rendered as the API answers with them, under `name`, with the counts every list answers with. */
export function pageOf<T>(name: string, records: readonly T[], { page, page_size }: Paging, render: (record: T) => unknown) {
  const items = records.slice((page - 1) * page_size, page * page_size).map(render);
  return { page, page_size, total_pages: Math.ceil(records.length / page_size), total_items: records.length, [name]: items };
}

export interface Sort<Key extends string> {
  by: Key;
  descending: boolean;
}

/** The sort asked for, from the attributes this list sorts by, or what's wrong with it. */
export function readSort<Key extends string>(req: ListRequest, sortable: readonly Key[], fallback: Key): Sort<Key> | { problem: string } {
  const by = req.query("sort_by") || fallback;
  const direction = req.query("sort_direction") || "desc";
  if (!(sortable as readonly string[]).includes(by)) return { problem: `sort_by must be one of ${sortable.join(", ")}, not "${by}".` };
  if (direction !== "asc" && direction !== "desc") return { problem: `sort_direction must be asc or desc, not "${direction}".` };
  return { by: by as Key, descending: direction === "desc" };
}

type Sortable = string | number | null | undefined;

/**
 * An invoice_number to sort by. JobCreate types it as a number, and the twin only makes numbers, so lists sort them as
 * numbers, 2 before 10, though answers write them as text (FIDELITY.md).
 */
export function invoiceNumberOrder(invoiceNumber: string): number | string {
  return /^\d+$/.test(invoiceNumber) ? Number(invoiceNumber) : invoiceNumber;
}

/**
 * `records` sorted by `value`, which the caller reads from each record for `sort.by`. Text compares without regard to
 * case, and an empty value sorts after every other, as a Postgres database sorts NULL (the docs say neither). Ties keep
 * the order records were created in, reversed for `desc`, so every page of a list holds the same records each time.
 */
export function sorted<T, Key extends string>(records: Iterable<T>, sort: Sort<Key>, value: (record: T, by: Key) => Sortable): T[] {
  const ascending = [...records]
    .map((record, index) => ({ record, index, value: value(record, sort.by) }))
    .sort((a, b) => compare(a.value, b.value) || a.index - b.index)
    .map(({ record }) => record);
  return sort.descending ? ascending.reverse() : ascending;
}

function compare(a: Sortable, b: Sortable): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const [x, y] = [String(a).toLowerCase(), String(b).toLowerCase()];
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * The `expand` values asked for, as `expand[]=a&expand[]=b` (what Rails clients send) or `expand=a`, or what's wrong
 * with them. Each list documents the values it takes.
 */
export function readExpand(req: ListRequest, allowed: readonly string[]): Set<string> | { problem: string } {
  const asked = [...(req.queries("expand[]") ?? []), ...(req.queries("expand") ?? [])].filter(Boolean); // as filters ignore empties
  const unknown = asked.find((value) => !allowed.includes(value));
  if (unknown !== undefined) return { problem: `expand takes ${allowed.join(" and ")}, not "${unknown}".` };
  return new Set(asked);
}
