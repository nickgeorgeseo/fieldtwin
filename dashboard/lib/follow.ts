/**
 * Following a list the twin keeps adding to (the event log, the changes since a checkpoint) without reading all of it
 * each time it grows. Every read of one says where the log ends (its X-Twin-Log-Position header); sent back as
 * ?after=, it gets only what came since. When the log is no longer the history that position is in (a reset, a
 * rewind, a scenario, or a restarted twin), the twin answers 409, and the list is read again from the start.
 */

/** A list as far as a page has read it, and where the log ended then: null before the first read, or for a twin too old to say. */
export interface Followed<T> {
  items: T[];
  position: string | null;
}

export const NOT_READ: Followed<never> = { items: [], position: null };

/** One read: what came after a position (everything, for null), and where the log ends; or "changed" for the 409. */
export type Read<T> = Followed<T> | "changed";

/**
 * Read on from where `list` left off: only what came since, added to the end, or all of it again if the log has changed
 * in between. When nothing is new, this is the very same list, so a page that shows it doesn't redraw.
 */
export async function follow<T>(list: Followed<T>, read: (after: string | null) => Promise<Read<T>>): Promise<Followed<T>> {
  if (list.position !== null) {
    const since = await read(list.position);
    // No position means a twin that ignores ?after= and answered with all of it: read it from the start instead.
    if (since !== "changed" && since.position !== null) {
      return since.items.length ? { items: [...list.items, ...since.items], position: since.position } : list;
    }
  }
  const all = await read(null);
  return all === "changed" ? NOT_READ : all;
}
