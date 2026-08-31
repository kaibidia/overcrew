import { describe, it, expect } from "vitest";
import type { Intent } from "@overcrew/shared";
import { Game } from "./game";

const PLAYERS = ["A", "B"];

function intentFor(game: Game, instructionId: string): {
  ownerId: string;
  intent: Intent;
} {
  const ins = game.instructions.find((i) => i.id === instructionId)!;
  const control = game.controls.find((c) => c.id === ins.controlId)!;
  const intent: Intent =
    ins.expected.kind === "press"
      ? { type: "press", controlId: control.id }
      : ins.expected.kind === "toggle"
        ? { type: "set", controlId: control.id, value: ins.expected.on }
        : { type: "set", controlId: control.id, value: ins.expected.value };
  return { ownerId: control.ownerPlayerId!, intent };
}

describe("Game", () => {
  it("generates one panel + one instruction per player from a seed", () => {
    const g = new Game(PLAYERS, "fixed-seed");
    expect(new Set(g.controls.map((c) => c.ownerPlayerId))).toEqual(
      new Set(PLAYERS),
    );
    expect(g.instructions).toHaveLength(2);
  });

  it("completes an instruction and issues a replacement for the same recipient", () => {
    const g = new Game(PLAYERS, "seed-1");
    const first = g.instructions[0]!;
    const { ownerId, intent } = intentFor(g, first.id);

    const res = g.applyIntent(ownerId, intent);
    expect(res.completed).toBe(true);
    expect(g.instructions).toHaveLength(2); // one retired, one added
    expect(g.instructions.some((i) => i.id === first.id)).toBe(false);
    expect(
      g.instructions.filter((i) => i.shownToPlayerId === first.shownToPlayerId),
    ).toHaveLength(1);
  });

  it("ignores an intent from a player who does not own the control", () => {
    const g = new Game(PLAYERS, "seed-2");
    const control = g.controls[0]!;
    const notOwner = PLAYERS.find((p) => p !== control.ownerPlayerId)!;
    const before = JSON.stringify(g.instructions);
    const res = g.applyIntent(notOwner, { type: "press", controlId: control.id });
    expect(res).toEqual({ changed: false, completed: false });
    expect(JSON.stringify(g.instructions)).toBe(before);
  });

  it("viewFor exposes only that player's controls and instructions", () => {
    const g = new Game(PLAYERS, "seed-3");
    const room = {
      code: "BCDF",
      phase: "playing" as const,
      players: [],
      protocolVersion: 1,
    };
    const view = g.viewFor(room, "A");
    expect(view.panel.every((c) => c.ownerPlayerId === "A")).toBe(true);
    expect(view.instructions.every((i) => i.shownToPlayerId === "A")).toBe(true);
  });
});
