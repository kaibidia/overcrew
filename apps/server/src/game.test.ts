import { describe, it, expect } from "vitest";
import { difficultyFor, type Intent } from "@overcrew/shared";
import { Game } from "./game";

const PLAYERS = ["A", "B", "C"];

/** A game with a controllable clock. */
function makeGame(players = PLAYERS, seed = "seed") {
  const clock = { t: 1_000_000 };
  const g = new Game(players, { seed, now: () => clock.t });
  return { g, clock, advance: (ms: number) => (clock.t += ms) };
}

/** Build the intent that satisfies an instruction. */
function intentFor(g: Game, instructionId: string): { ownerId: string; intent: Intent } {
  const ins = g.instructions.find((i) => i.id === instructionId)!;
  const c = g.controls.find((x) => x.id === ins.controlId)!;
  const e = ins.expected;
  let intent: Intent;
  switch (e.kind) {
    case "press": intent = { type: "press", controlId: c.id }; break;
    case "toggle": intent = { type: "set", controlId: c.id, value: e.on }; break;
    case "direction":
    case "select": intent = { type: "set", controlId: c.id, value: e.value }; break;
    case "slider": intent = { type: "set", controlId: c.id, value: e.task.targetValue }; break;
    case "dial": intent = { type: "set", controlId: c.id, value: e.position }; break;
  }
  return { ownerId: c.ownerPlayerId!, intent };
}

describe("Game — setup", () => {
  it("generates 4–6-control panels and one instruction per player, health full", () => {
    const { g } = makeGame();
    expect(new Set(g.controls.map((c) => c.ownerPlayerId))).toEqual(new Set(PLAYERS));
    for (const p of PLAYERS) {
      const n = g.controls.filter((c) => c.ownerPlayerId === p).length;
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(6);
    }
    expect(g.instructions).toHaveLength(3);
    expect(g.ship().health).toBe(100);
    expect(g.ship().phase).toBe("playing");
    expect(g.ship().level).toBe(1);
  });
});

describe("Game — completing instructions", () => {
  it("completes, replaces (different control), bumps progress and heals a little", () => {
    const { g } = makeGame(PLAYERS, "complete");
    // spend health first so the heal is observable
    g.instructions.forEach((i) => (i.deadlineAt = 0));
    g.step(); // all expire
    const hurt = g.ship().health;
    expect(hurt).toBeLessThan(100);

    const first = g.instructions[0]!;
    const { ownerId, intent } = intentFor(g, first.id);
    const res = g.applyIntent(ownerId, intent);
    expect(res.completed).toBe(true);
    expect(g.ship().progress).toBe(1);
    expect(g.ship().health).toBeGreaterThan(hurt);
    const repl = g.instructions.find((i) => i.shownToPlayerId === first.shownToPlayerId)!;
    expect(repl.controlId).not.toBe(first.controlId);
  });

  it("ignores an intent from a non-owner", () => {
    const { g } = makeGame(PLAYERS, "nonowner");
    const c = g.controls[0]!;
    const notOwner = PLAYERS.find((p) => p !== c.ownerPlayerId)!;
    const before = JSON.stringify(g.instructions);
    expect(g.applyIntent(notOwner, { type: "press", controlId: c.id })).toEqual({
      changed: false,
      completed: false,
    });
    expect(JSON.stringify(g.instructions)).toBe(before);
  });
});

describe("Game — the 1 Hz loop", () => {
  it("expires overdue instructions, drains health, issues fresh ones", () => {
    const { g, advance } = makeGame(PLAYERS, "expire");
    const ids0 = g.instructions.map((i) => i.id);
    advance(30_000); // well past the level-1 deadline
    g.step();
    expect(g.ship().health).toBeLessThan(100);
    // still one active instruction per player, all new
    expect(g.instructions).toHaveLength(3);
    expect(g.instructions.some((i) => ids0.includes(i.id))).toBe(false);
  });

  it("does not expire an instruction that is still within its deadline", () => {
    const { g, advance } = makeGame(PLAYERS, "safe");
    advance(3_000);
    g.step();
    expect(g.ship().health).toBe(100);
  });

  it("ramps difficulty: more instructions per player at higher levels", () => {
    const { g, advance } = makeGame(PLAYERS, "ramp");
    expect(g.instructions).toHaveLength(3); // level 1: 1 each
    advance(difficultyFor(3).deadlineMs > 0 ? 45_000 : 45_000); // -> level 3
    g.step();
    expect(g.ship().level).toBeGreaterThanOrEqual(3);
    for (const p of PLAYERS) {
      expect(
        g.instructions.filter((i) => i.shownToPlayerId === p).length,
      ).toBe(2);
    }
  });

  it("ends the game at 0 health and stops the loop", () => {
    const { g, advance } = makeGame(["A", "B"], "death");
    for (let k = 0; k < 40 && !g.isOver; k++) {
      g.instructions.forEach((i) => (i.deadlineAt = 0));
      advance(1_000);
      g.step();
    }
    expect(g.isOver).toBe(true);
    expect(g.ship().phase).toBe("gameover");
    expect(g.ship().overReason).toBe("health");
    expect(g.ship().health).toBe(0);
    // further steps / intents do nothing
    const prog = g.ship().progress;
    g.step();
    const first = g.instructions[0];
    if (first) {
      const { ownerId, intent } = intentFor(g, first.id);
      g.applyIntent(ownerId, intent);
    }
    expect(g.ship().progress).toBe(prog);
  });
});

describe("Game — crew changes", () => {
  it("drops a leaver's controls and re-issues instructions that referenced them", () => {
    const { g } = makeGame(["A", "B", "C"], "leave");
    g.removePlayer("C");
    expect(g.controls.every((c) => c.ownerPlayerId !== "C")).toBe(true);
    expect(g.instructions.every((i) => i.shownToPlayerId !== "C")).toBe(true);
    for (const i of g.instructions) {
      expect(g.controls.some((c) => c.id === i.controlId)).toBe(true);
    }
    expect(g.isOver).toBe(false);
  });

  it("ends the game when the crew drops below two", () => {
    const { g } = makeGame(["A", "B"], "crew");
    g.removePlayer("B");
    expect(g.isOver).toBe(true);
    expect(g.ship().overReason).toBe("crew");
  });
});

describe("Game — per-player view", () => {
  it("exposes only that player's controls, instruction views, and the ship", () => {
    const { g } = makeGame();
    const room = { code: "BCDF", phase: "playing" as const, players: [], protocolVersion: 1 };
    const view = g.viewFor(room, "A");
    expect(view.panel.every((c) => c.ownerPlayerId === "A")).toBe(true);
    expect(view.instructions.every((i) => i.remainingMs > 0)).toBe(true);
    expect(view.ship.maxHealth).toBe(100);
  });
});
