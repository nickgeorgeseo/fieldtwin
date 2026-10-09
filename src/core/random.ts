/**
 * A small seeded random number generator (the "mulberry32" algorithm).
 *
 * Same seed, same sequence, every time, on every machine.
 * Never use Math.random() in this project; ask for a SeededRandom instead.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A number from 0 (inclusive) to 1 (exclusive). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number from min to max, both inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability (0 to 1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("SeededRandom.pick: cannot pick from an empty list");
    return items[this.int(0, items.length - 1)]!;
  }
}
