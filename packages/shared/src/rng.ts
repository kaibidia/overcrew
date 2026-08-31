/**
 * Seeded pseudo-random generator.
 *
 * All generation in Overcrew (panels, instruction targeting, balancing) must go
 * through a seeded RNG so a reported bug can be reproduced from its seed alone.
 * See docs/DECISIONS.md D9 / docs/ARCHITECTURE.md §7.
 *
 * The algorithm is mulberry32: tiny, fast, deterministic, good enough for game
 * content generation (not for cryptography).
 */

export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** A uniformly chosen element of `items`. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** A new array with the elements of `items` in a shuffled order (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
}

/** Hash an arbitrary string seed into a 32-bit unsigned integer (xfnv1a). */
export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  let a = (typeof seed === "number" ? seed >>> 0 : hashSeed(seed)) || 1;

  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (max < min) throw new RangeError(`int(${min}, ${max}): max < min`);
    return min + Math.floor(next() * (max - min + 1));
  };

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new RangeError("pick(): empty array");
    return items[int(0, items.length - 1)] as T;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    return out;
  };

  return { next, int, pick, shuffle };
}
