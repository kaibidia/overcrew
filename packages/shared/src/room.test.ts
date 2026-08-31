import { describe, it, expect } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  canStart,
  connectedCount,
  generateRoomCode,
  isValidRoomCode,
  normalizeNickname,
  normalizeRoomCode,
  type PublicPlayer,
} from "./room";
import { createRng } from "./rng";

describe("room codes", () => {
  it("are 4 chars from the shout-friendly alphabet", () => {
    const rng = createRng("codes");
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode(rng.next);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect([...code].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
      expect(code).not.toMatch(/[AEIOU01]/);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it("are deterministic for a given random source", () => {
    expect(generateRoomCode(createRng("seed-1").next)).toBe(
      generateRoomCode(createRng("seed-1").next),
    );
  });

  it("have low collision over many draws", () => {
    const rng = createRng("collision");
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateRoomCode(rng.next));
    expect(seen.size).toBeGreaterThan(1990);
  });

  it("isValidRoomCode rejects wrong length, vowels and digits 0/1", () => {
    expect(isValidRoomCode("BCD")).toBe(false);
    expect(isValidRoomCode("BCDFG")).toBe(false);
    expect(isValidRoomCode("BCDA")).toBe(false);
    expect(isValidRoomCode("BCD0")).toBe(false);
    expect(isValidRoomCode("bcdf")).toBe(false);
  });

  it("normalizeRoomCode uppercases and strips noise", () => {
    expect(normalizeRoomCode("  bc-df ")).toBe("BCDF");
    expect(normalizeRoomCode("k2 k 2")).toBe("K2K2");
  });
});

describe("normalizeNickname", () => {
  it("trims, collapses whitespace and caps length", () => {
    expect(normalizeNickname("  Капитан   Джек  ")).toBe("Капитан Джек");
    expect(normalizeNickname("x".repeat(40))).toHaveLength(16);
  });
});

const p = (
  id: string,
  isHost: boolean,
  connection: PublicPlayer["connection"] = "connected",
): PublicPlayer => ({ id, nickname: id, isHost, connection });

describe("canStart", () => {
  it("is true only for the host, in lobby, with ≥ 2 connected players", () => {
    const players = [p("a", true), p("b", false)];
    expect(canStart({ phase: "lobby", players }, "a")).toBe(true);
    expect(canStart({ phase: "lobby", players }, "b")).toBe(false);
  });

  it("is false with only one connected player", () => {
    const players = [p("a", true), p("b", false, "disconnected")];
    expect(connectedCount(players)).toBe(1);
    expect(canStart({ phase: "lobby", players }, "a")).toBe(false);
  });

  it("is false once the game is playing", () => {
    const players = [p("a", true), p("b", false)];
    expect(canStart({ phase: "playing", players }, "a")).toBe(false);
  });
});
