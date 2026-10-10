/**
 * Relay-style connections, the way every Jobber list is paged. Jobber's docs say its pagination is "based on the
 * Relay framework" and name `first` and `last` (https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits,
 * Connection Fields and Avoiding Rate Limits). The Relay connection spec gives the rest, `before` and exactly how
 * each argument moves the page and sets pageInfo: https://relay.dev/graphql/connections.htm
 *
 * `after` and `before` narrow the list to what lies between two cursors; then `first` keeps the start of that and
 * `last` its end. With neither, `first` is 100, as documented, and neither can ask for more. All four are nullable,
 * so `after: null` (how Relay clients ask for the first page) means the same as leaving it out. Cursors are opaque to callers; inside the twin
 * a cursor is a position in the list.
 */
export interface PageArgs {
  first?: number | null;
  after?: string | null;
  last?: number | null;
  before?: string | null;
}

/**
 * "All connection fields are configured to return a maximum of 100 nodes." Like graphql-ruby, which Jobber runs, a
 * larger `first` or `last` is capped at 100 and a negative one counts as 0 (FIDELITY.md marks both "check").
 */
export const MAX_PAGE_SIZE = 100;

function pageSize(size: number | null | undefined): number | undefined {
  return size === undefined || size === null ? undefined : Math.min(MAX_PAGE_SIZE, Math.max(0, size));
}

export function connection<T, Node>(items: readonly T[], args: PageArgs, toNode: (item: T) => Node) {
  // ApplyCursorsToEdges: the part of the list after `after` and before `before`, as [from, to).
  const after = positionOf(args.after);
  const before = positionOf(args.before);
  const from = after === undefined ? 0 : after + 1;
  const to = Math.max(from, Math.min(items.length, before ?? items.length));

  // EdgesToReturn: `first` keeps the start of that, then `last` its end.
  const last = pageSize(args.last);
  const first = pageSize(args.first) ?? (last === undefined ? MAX_PAGE_SIZE : undefined);
  let start = from;
  let end = to;
  if (first !== undefined) end = Math.min(end, start + first);
  if (last !== undefined) start = Math.max(start, end - last);

  const nodes = items.slice(start, end).map(toNode);
  return {
    nodes,
    edges: nodes.map((node, index) => ({ node, cursor: encodeCursor(start + index) })),
    totalCount: items.length,
    pageInfo: {
      // HasPreviousPage and HasNextPage, as the spec defines them. The twin can always tell whether anything comes
      // before `after` or after `before`, which the spec leaves to servers that can do so efficiently.
      hasPreviousPage: last !== undefined ? to - from > last : after !== undefined,
      hasNextPage: first !== undefined ? to - from > first : before !== undefined && before < items.length,
      startCursor: nodes.length ? encodeCursor(start) : null,
      endCursor: nodes.length ? encodeCursor(end - 1) : null,
    },
  };
}

function positionOf(cursor: string | null | undefined): number | undefined {
  return cursor === undefined || cursor === null ? undefined : decodeCursor(cursor);
}

function encodeCursor(index: number): string {
  return Buffer.from(`cursor:${index}`).toString("base64");
}

function decodeCursor(cursor: string): number {
  const match = /^cursor:(\d+)$/.exec(Buffer.from(cursor, "base64").toString());
  if (!match) throw new Error(`"${cursor}" is not a cursor this API issued. Use a cursor from a previous page's edges or pageInfo.`);
  return Number(match[1]);
}
