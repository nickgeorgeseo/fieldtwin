import type { Checkpoint } from "./types.ts";

/**
 * Named moments in a twin's history: a position in the event log, the twin time then, and whatever else the twin
 * keeps to go back there exactly (`Saved`; for the twin, where its fault dice were).
 */
export class Checkpoints<Saved> {
  private named = new Map<string, { checkpoint: Checkpoint; saved: Saved }>();

  take(name: string, seq: number, time: string, saved: Saved): Checkpoint {
    const checkpoint = { name, seq, time };
    this.named.set(name, { checkpoint, saved });
    return checkpoint;
  }

  get(name: string): Checkpoint {
    return this.entry(name).checkpoint;
  }

  saved(name: string): Saved {
    return this.entry(name).saved;
  }

  private entry(name: string) {
    const entry = this.named.get(name);
    if (!entry) throw new Error(`No checkpoint named "${name}"`);
    return entry;
  }

  /** After a rewind to `seq`: checkpoints taken later point at history that no longer exists. */
  forgetAfter(seq: number): void {
    for (const [name, { checkpoint }] of this.named) {
      if (checkpoint.seq > seq) this.named.delete(name);
    }
  }

  all(): Checkpoint[] {
    return [...this.named.values()].map(({ checkpoint }) => checkpoint);
  }

  clear(): void {
    this.named.clear();
  }
}
