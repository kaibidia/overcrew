import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import {
  buildPlayerView,
  generateInstructions,
  generatePanels,
  nextInstruction,
  validateIntent,
  type Instruction,
  type Intent,
} from "./game";
import { hasUniqueLabels, type ControlInstance } from "./model";
import type { RoomView } from "./room";

const PLAYERS = ["p1", "p2", "p3"];
const panelFor = (seed: string) =>
  generatePanels(PLAYERS, createRng(seed));

describe("generatePanels", () => {
  it("gives every player a panel of Stage 3 controls with a set owner", () => {
    const controls = panelFor("panels");
    for (const pid of PLAYERS) {
      const mine = controls.filter((c) => c.ownerPlayerId === pid);
      expect(mine.length).toBeGreaterThanOrEqual(2);
      expect(mine.length).toBeLessThanOrEqual(3);
      for (const c of mine) {
        expect(["button", "toggle", "shapeSelector"]).toContain(
          c.definition.kind,
        );
      }
    }
  });

  it("uses globally unique labels and ids", () => {
    const controls = panelFor("uniq");
    expect(hasUniqueLabels(controls)).toBe(true);
    expect(new Set(controls.map((c) => c.id)).size).toBe(controls.length);
  });

  it("is deterministic for a seed", () => {
    expect(JSON.stringify(panelFor("s"))).toBe(JSON.stringify(panelFor("s")));
  });

  it("scales down controls-per-player as players increase", () => {
    const many = generatePanels(
      Array.from({ length: 6 }, (_, i) => `q${i}`),
      createRng("many"),
    );
    expect(hasUniqueLabels(many)).toBe(true);
    expect(many.length).toBe(6 * 2); // 16 dedicated names / 6 players -> 2 each
  });
});

describe("generateInstructions", () => {
  it("makes exactly one active instruction per player", () => {
    const controls = panelFor("ins");
    const ins = generateInstructions(PLAYERS, controls, createRng("ins"));
    expect(ins).toHaveLength(PLAYERS.length);
    expect(ins.map((i) => i.shownToPlayerId).sort()).toEqual([...PLAYERS].sort());
  });

  it("embeds the target control's label verbatim in the text", () => {
    const controls = panelFor("text");
    const ins = generateInstructions(PLAYERS, controls, createRng("text"));
    for (const i of ins) {
      expect(i.text).toContain(i.controlLabel);
      expect(controls.some((c) => c.id === i.controlId)).toBe(true);
    }
  });

  it("never points two active instructions at the same control", () => {
    const controls = panelFor("dup");
    const ins = generateInstructions(PLAYERS, controls, createRng("dup"));
    expect(new Set(ins.map((i) => i.controlId)).size).toBe(ins.length);
  });

  it("recipient and target owner are independent — both equal and unequal occur", () => {
    let same = 0;
    let diff = 0;
    for (let s = 0; s < 120; s++) {
      const controls = panelFor(`indep${s}`);
      for (const i of generateInstructions(
        PLAYERS,
        controls,
        createRng(`i${s}`),
      )) {
        const owner = controls.find((c) => c.id === i.controlId)!.ownerPlayerId;
        if (owner === i.shownToPlayerId) same++;
        else diff++;
      }
    }
    expect(same).toBeGreaterThan(0);
    expect(diff).toBeGreaterThan(0);
    expect(same).toBeLessThan(diff); // self-targeting is the minority
  });

  it("spreads instructions across owners (no one owner gets them all)", () => {
    const controls = generatePanels(["a", "b", "c", "d"], createRng("spread"));
    const ins = generateInstructions(["a", "b", "c", "d"], controls, createRng("s"));
    const owners = new Set(
      ins.map((i) => controls.find((c) => c.id === i.controlId)!.ownerPlayerId),
    );
    expect(owners.size).toBeGreaterThanOrEqual(3);
  });
});

describe("validateIntent", () => {
  const setup = (seed: string) => {
    const controls = panelFor(seed);
    const instructions = generateInstructions(PLAYERS, controls, createRng(seed));
    return { controls, instructions };
  };
  const ownerOf = (c: ControlInstance) => c.ownerPlayerId!;

  it("completes a press instruction when the owner presses the target", () => {
    const game = setup("press");
    const target = game.instructions.find((i) => i.expected.kind === "press");
    if (!target) return; // seed produced none — fine
    const control = game.controls.find((c) => c.id === target.controlId)!;
    const res = validateIntent(game, ownerOf(control), {
      type: "press",
      controlId: control.id,
    });
    expect(res.ok).toBe(true);
    expect(res.completedInstructionId).toBe(target.id);
  });

  it("completes a select instruction only for the requested value", () => {
    const game = setup("select");
    const ins = game.instructions.find((i) => i.expected.kind === "select") as
      | (Instruction & { expected: { kind: "select"; value: string | number } })
      | undefined;
    if (!ins) return;
    const control = game.controls.find((c) => c.id === ins.controlId)!;
    const wrong: Intent = {
      type: "set",
      controlId: control.id,
      value: control.definition.kind === "shapeSelector"
        ? control.definition.values.find((v) => v !== ins.expected.value)!
        : 0,
    };
    expect(validateIntent(game, ownerOf(control), wrong).completedInstructionId)
      .toBeUndefined();
    const right: Intent = {
      type: "set",
      controlId: control.id,
      value: ins.expected.value,
    };
    expect(validateIntent(game, ownerOf(control), right).completedInstructionId)
      .toBe(ins.id);
  });

  it("rejects an intent from a non-owner", () => {
    const game = setup("owner");
    const control = game.controls[0]!;
    const notOwner = PLAYERS.find((p) => p !== control.ownerPlayerId)!;
    const res = validateIntent(game, notOwner, {
      type: "press",
      controlId: control.id,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_owner");
  });

  it("is a valid no-op when the control matches no instruction", () => {
    const game = setup("noop");
    const targeted = new Set(game.instructions.map((i) => i.controlId));
    const idle = game.controls.find((c) => !targeted.has(c.id))!;
    const res = validateIntent(game, idle.ownerPlayerId!, {
      type: "press",
      controlId: idle.id,
    });
    expect(res.ok).toBe(true);
    expect(res.completedInstructionId).toBeUndefined();
  });

  it("cross-player: an instruction shown to A is completed when its owner B acts", () => {
    // find an instruction whose recipient != target owner
    for (let s = 0; s < 50; s++) {
      const game = setup(`cross${s}`);
      const cross = game.instructions.find((i) => {
        const owner = game.controls.find((c) => c.id === i.controlId)!.ownerPlayerId;
        return owner !== i.shownToPlayerId;
      });
      if (!cross) continue;
      const control = game.controls.find((c) => c.id === cross.controlId)!;
      const intent: Intent =
        cross.expected.kind === "press"
          ? { type: "press", controlId: control.id }
          : cross.expected.kind === "toggle"
            ? { type: "set", controlId: control.id, value: cross.expected.on }
            : { type: "set", controlId: control.id, value: cross.expected.value };
      const res = validateIntent(game, control.ownerPlayerId!, intent);
      expect(res.completedInstructionId).toBe(cross.id);
      return;
    }
    throw new Error("no cross-player instruction generated in 50 seeds");
  });
});

describe("buildPlayerView", () => {
  it("returns only the player's own panel and instructions", () => {
    const controls = panelFor("view");
    const instructions = generateInstructions(PLAYERS, controls, createRng("view"));
    const room = { code: "BCDF", phase: "playing", players: [], protocolVersion: 1 } as RoomView;
    const view = buildPlayerView(room, "p2", { controls, instructions });
    expect(view.panel.every((c) => c.ownerPlayerId === "p2")).toBe(true);
    expect(view.instructions.every((i) => i.shownToPlayerId === "p2")).toBe(true);
    expect(view.you).toBe("p2");
  });
});
