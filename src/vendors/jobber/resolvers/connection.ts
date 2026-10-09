/**
 * Relay-style connections, the way every Jobber list is paged:
 * https://developer.getjobber.com/docs/using_jobbers_api/api_rate_limits (Avoiding Rate Limits)
 *
 * `first` sets the page size (100 when omitted, as documented) and `after` resumes after a cursor. Both are
 * nullable, so `after: null` (how Relay clients ask for the first page) means the same as leaving it out.
 * Cursors are opaque to callers; inside the twin a cursor is a position in the list.
 */
export interface PageArgs {
  first?: number | null;
  after?: string | null;
}

const DEFAULT_PAGE_SIZE = 100;

export function connection<T, Node>(items: readonly T[], args: PageArgs, toNode: (item: T) => Node) {
  const start = args.after === undefined || args.after === null ? 0 : decodeCursor(args.after) + 1;
  const page = items.slice(start, start + (args.first ?? DEFAULT_PAGE_SIZE));
  const nodes = page.map(toNode);
  return {
    nodes,
    edges: nodes.map((node, index) => ({ node, cursor: encodeCursor(start + index) })),
    totalCount: items.length,
    pageInfo: {
      hasNextPage: start + page.length < items.length,
      hasPreviousPage: start > 0,
      startCursor: page.length ? encodeCursor(start) : null,
      endCursor: page.length ? encodeCursor(start + page.length - 1) : null,
    },
  };
}

function encodeCursor(index: number): string {
  return Buffer.from(`cursor:${index}`).toString("base64");
}

function decodeCursor(cursor: string): number {
  const match = /^cursor:(\d+)$/.exec(Buffer.from(cursor, "base64").toString());
  if (!match) throw new Error(`"${cursor}" is not a cursor this API issued. Use an endCursor or edge cursor from a previous page.`);
  return Number(match[1]);
}
