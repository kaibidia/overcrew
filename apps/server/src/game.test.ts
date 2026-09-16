import { describe, it, expect } from "vitest";
import { buildScoreboard, difficultyFor, type Intent } from "@overcrew/shared";
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
    case "hold":
    case "syncHold": intent = { type: "hold-start", controlId: c.id }; break;
  }
  return { ownerId: c.ownerPlayerId!, intent };
}

/** Pick an instruction whose expectation is value-based (completable via one intent). */
function valueBasedInstruction(g: Game): string {
  const ins = g.instructions.find(
    (i) => i.expected.kind !== "hold" && i.expected.kind !== "syncHold",
  );
  if (!ins) throw new Error("no value-based instruction");
  return ins.id;
}

/** Force the first instruction to be a solo hold on a real hold control. */
function forceHold(g: Game, forMs = 3000) {
  const c = g.controls.find((x) => x.definition.kind === "hold")!;
  const ins = g.instructions[0]!;
  ins.expected = { kind: "hold", forMs };
  ins.controlId = c.id;
  ins.controlLabel = c.label;
  ins.deadlineAt = 9_999_999_999;
  return { ins, c };
}

function forceSyncHold(g: Game, forMs = 3000) {
  const [a, b] = g.controls.filter((x) => x.definition.kind === "hold");
  const ins = g.instructions[0]!;
  ins.expected = {
    kind: "syncHold",
    forMs,
    withControlId: b!.id,
    withControlLabel: b!.label,
  };
  ins.controlId = a!.id;
  ins.controlLabel = a!.label;
  ins.deadlineAt = 9_999_999_999;
  return { ins, a: a!, b: b! };
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

    const firstId = valueBasedInstruction(g);
    const first = g.instructions.find((i) => i.id === firstId)!;
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

describe("Game — holds (Stage 6)", () => {
  it("solo hold completes only after being held continuously for forMs", () => {
    const { g, advance } = makeGame(PLAYERS, "hold");
    const { ins, c } = forceHold(g, 3000);
    const owner = c.ownerPlayerId!;

    g.applyIntent(owner, { type: "hold-start", controlId: c.id });
    advance(2000);
    g.step();
    expect(g.instructions.some((i) => i.id === ins.id)).toBe(true); // not yet
    advance(1500);
    g.step();
    expect(g.instructions.some((i) => i.id === ins.id)).toBe(false); // done
    expect(g.ship().progress).toBe(1);
  });

  it("releasing the hold resets progress", () => {
    const { g, advance } = makeGame(PLAYERS, "hold2");
    const { ins, c } = forceHold(g, 3000);
    const owner = c.ownerPlayerId!;

    g.applyIntent(owner, { type: "hold-start", controlId: c.id });
    advance(2500);
    g.applyIntent(owner, { type: "hold-end", controlId: c.id });
    advance(2000);
    g.applyIntent(owner, { type: "hold-start", controlId: c.id }); // grab again
    advance(2500);
    g.step();
    expect(g.instructions.some((i) => i.id === ins.id)).toBe(true); // only 2.5s so far
    advance(1000);
    g.step();
    expect(g.instructions.some((i) => i.id === ins.id)).toBe(false);
  });

  it("sync hold needs both controls; releasing either resets", () => {
    const { g, advance } = makeGame(PLAYERS, "sync");
    const { ins, a, b } = forceSyncHold(g, 3000);

    g.applyIntent(a.ownerPlayerId!, { type: "hold-start", controlId: a.id });
    advance(4000);
    g.step();
    expect(g.instructions.some((i) => i.id === ins.id)).toBe(true); // only one held

    g.applyIntent(b.ownerPlayerId!, { type: "hold-start", controlId: b.id });
    advance(2000);
    g.applyIntent(a.ownerPlayerId!, { type: "hold-end", controlId: a.id }); // one lets go
    advance(2000);
    g.step();
    expect(g.instructions.some((i) => i.id === ins.id)).toBe(true); // reset

    g.applyIntent(a.ownerPlayerId!, { type: "hold-start", controlId: a.id });
    advance(3500);
    g.step();
    expect(g.instructions.some((i) => i.id === ins.id)).toBe(false); // both held long enough
    expect(g.ship().progress).toBe(1);
  });

  it("releaseHolds breaks a sync hold in progress", () => {
    const { g, advance } = makeGame(PLAYERS, "sync2");
    const { ins, a, b } = forceSyncHold(g, 3000);
    g.applyIntent(a.ownerPlayerId!, { type: "hold-start", controlId: a.id });
    g.applyIntent(b.ownerPlayerId!, { type: "hold-start", controlId: b.id });
    advance(1500);
    g.releaseHolds(a.ownerPlayerId!); // A's phone drops
    advance(3000);
    g.step();
    expect(g.instructions.some((i) => i.id === ins.id)).toBe(true);
  });
});

describe("Game — the 1 Hz loop", () => {
  it("expires overdue instructions, drains health, issues fresh ones", () => {
    const { g, advance } = makeGame(PLAYERS, "expire");
    const ids0 = g.instructions.map((i) => i.id);
    advance(38_000); // past every deadline (incl. extended hold ones), still level 2
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

describe("Game — telemetry & crash scoreboard (Stage 7)", () => {
  it("gives every instruction a unique id", () => {
    const { g } = makeGame(PLAYERS, "telemetry-ids");
    const ids = g.instructions.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no scoreboard until the game actually ends", () => {
    const { g } = makeGame(PLAYERS, "telemetry-none");
    expect(g.getScoreboard()).toBeUndefined();
  });

  it("records transmission separately from execution, timed from the transmission", () => {
    const { g, advance } = makeGame(PLAYERS, "telemetry-exec");
    const insId = valueBasedInstruction(g);
    advance(500);
    g.markSeen(insId); // delivered to a connected socket
    advance(1200);
    const { ownerId, intent } = intentFor(g, insId);
    g.applyIntent(ownerId, intent);

    const events = g.getTelemetry();
    const transmitted = events.find(
      (e) => e.type === "instruction_transmitted" && e.instructionId === insId,
    );
    expect(transmitted).toMatchObject({ success: true });
    const resolved = events.find(
      (e) => e.type === "instruction_resolved" && e.instructionId === insId,
    );
    expect(resolved).toMatchObject({ status: "executed", durationMs: 1200 });
  });

  it("marks an instruction not-transmitted if it expires before ever reaching a connected client", () => {
    const { g } = makeGame(PLAYERS, "telemetry-notx");
    const insId = g.instructions[0]!.id;
    g.instructions.forEach((i) => (i.deadlineAt = 0));
    g.step();
    const transmitted = g
      .getTelemetry()
      .find((e) => e.type === "instruction_transmitted" && e.instructionId === insId);
    expect(transmitted).toMatchObject({
      success: false,
      failureReason: "recipient_never_connected",
    });
  });

  it("hold instructions measure execution duration from hold-start, not from transmission", () => {
    const { g, advance } = makeGame(PLAYERS, "telemetry-hold");
    const { ins, c } = forceHold(g, 3000);
    advance(500);
    g.markSeen(ins.id); // seen well before the player actually grabs the control
    advance(4000); // a long gap between seeing it and acting
    const owner = c.ownerPlayerId!;
    g.applyIntent(owner, { type: "hold-start", controlId: c.id });
    advance(3000);
    g.step();

    const resolved = g
      .getTelemetry()
      .find((e) => e.type === "instruction_resolved" && e.instructionId === ins.id);
    expect(resolved).toMatchObject({ status: "executed", durationMs: 3000 });
  });

  it("identifies the actual instruction and control owner responsible for a health crash", () => {
    const { g, advance } = makeGame(["A", "B"], "telemetry-crash");
    for (let k = 0; k < 40 && !g.isOver; k++) {
      g.instructions.forEach((i) => (i.deadlineAt = 0));
      advance(1_000);
      g.step();
    }
    expect(g.isOver).toBe(true);
    const board = g.getScoreboard();
    expect(board?.crash?.reason).toBe("health");
    expect(board?.crash?.instructionId).toBeDefined();
    const respId = board?.crash?.responsiblePlayerId;
    expect(["A", "B"]).toContain(respId);
    expect(board!.players.find((p) => p.playerId === respId)!.causedCrash).toBe(true);
  });

  it("does not attribute a crash to anyone when the crew simply falls apart", () => {
    const { g } = makeGame(["A", "B"], "telemetry-crew");
    g.removePlayer("B");
    const board = g.getScoreboard();
    expect(board?.crash?.reason).toBe("crew");
    expect(board?.crash?.responsiblePlayerId).toBeUndefined();
    expect(board?.crash?.instructionId).toBeUndefined();
  });

  it("a player leaving cancels their orphaned instructions instead of failing them", () => {
    const { g } = makeGame(["A", "B", "C"], "telemetry-leave");
    const orphanedIds = g.instructions
      .filter((i) => i.shownToPlayerId === "C")
      .map((i) => i.id);
    expect(orphanedIds.length).toBeGreaterThan(0);
    g.removePlayer("C");

    const events = g.getTelemetry();
    for (const id of orphanedIds) {
      const resolved = events.find(
        (e) => e.type === "instruction_resolved" && e.instructionId === id,
      );
      expect(resolved).toMatchObject({ status: "cancelled" });
    }
    // Disconnecting must never read as a failure once the scoreboard is built.
    const board = buildScoreboard(events);
    expect(board.players.every((p) => p.failed === 0)).toBe(true);
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

  it("carries no scoreboard while playing, and the built scoreboard once over", () => {
    const { g, advance } = makeGame(["A", "B"], "view-scoreboard");
    const room = { code: "BCDF", phase: "playing" as const, players: [], protocolVersion: 1 };
    expect(g.viewFor(room, "A").scoreboard).toBeUndefined();

    for (let k = 0; k < 40 && !g.isOver; k++) {
      g.instructions.forEach((i) => (i.deadlineAt = 0));
      advance(1_000);
      g.step();
    }
    expect(g.viewFor(room, "A").scoreboard).toEqual(g.getScoreboard());
  });
});
