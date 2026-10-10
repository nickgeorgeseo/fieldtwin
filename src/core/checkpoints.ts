import type { Checkpoint } from "./types.ts";

/** Named moments in a twin's history: a position in the event log, and the twin time then. */
export class Checkpoints {
  private named = new Map<string, Checkpoint>();

  take(name: string, seq: number, time: string): Checkpoint {
    const checkpoint = { name, seq, time };
    this.named.set(name, checkpoint);
    return checkpoint;
  }

  get(name: string): Checkpoint {
    const checkpoint = this.named.get(name);
    if (!checkpoint) throw new Error(`No checkpoint named "${name}"`);
    return checkpoint;
  }

  /** After a rewind to `seq`: checkpoints taken later point at history that no longer exists. */
  forgetAfter(seq: number): void {
    for (const [name, checkpoint] of this.named) {
      if (checkpoint.seq > seq) this.named.delete(name);
    }
  }

  clear(): void {
    this.named.clear();
  }
}
