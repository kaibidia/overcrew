import { describe, it, expect } from "vitest";
import { createRng, hashSeed } from "./rng";

describe("createRng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRng("overcrew");
    const b = createRng("overcrew");
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng("seed-a");
    const b = createRng("seed-b");
    expect(a.next()).not.toEqual(b.next());
  });

  it("next() stays within [0, 1)", () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("int() is inclusive of both bounds and never escapes the range", () => {
    const rng = createRng("bounds");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(1, 5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(5);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it("int() throws when max < min", () => {
    expect(() => createRng(1).int(5, 1)).toThrow(RangeError);
  });

  it("pick() returns an element and throws on empty", () => {
    const rng = createRng("pick");
    expect(["x", "y", "z"]).toContain(rng.pick(["x", "y", "z"]));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it("shuffle() is a permutation and does not mutate the input", () => {
    const rng = createRng("shuffle");
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
  });

  it("seeding by string and by its hashed number match", () => {
    const viaString = createRng("phase-lock");
    const viaNumber = createRng(hashSeed("phase-lock"));
    expect(viaString.next()).toEqual(viaNumber.next());
  });
});
