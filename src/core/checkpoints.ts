import type { Checkpoint } from "./types.ts";

/**
 * Named moments in a twin's history: a position in the event log, the twin time then, and whatever else the twin
 * keeps to go back there exactly (`Saved`; for the twin, where its fault dice were).
 */
export class Checkpoints<Saved> {
  private named = new Map<string, { checkpoint: Checkpoint; saved: Saved }>(); // in the order they were taken

  take(name: string, seq: number, time: string, saved: Saved): Checkpoint {
    const checkpoint = { name, seq, time };
    this.named.delete(name); // taking a name again makes it the latest, not a checkpoint from where it first stood
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

  /**
   * After a rewind to `name`: checkpoints taken later point at history that no longer exists. Later in the order taken,
   * not by log position: one taken after the clock moved but nothing was recorded has the same seq, and a later time.
   */
  forgetAfter(name: string): void {
    let later = false;
    for (const taken of [...this.named.keys()]) {
      if (later) this.named.delete(taken);
      later ||= taken === name;
    }
  }

  all(): Checkpoint[] {
    return [...this.named.values()].map(({ checkpoint }) => checkpoint);
  }
}
