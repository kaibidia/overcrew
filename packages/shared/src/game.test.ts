import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import {
  GAME_TYPES,
  MAX_PANEL_CONTROLS,
  MIN_PANEL_CONTROLS,
  buildPlayerView,
  generateInstructions,
  generatePanels,
  instructionText,
  nextInstruction,
  validateIntent,
  type ExpectedOutcome,
  type Instruction,
  type Intent,
} from "./game";
import {
  CONTROL_COMPLEXITY,
  getPanelComplexity,
  hasUniqueLabels,
  type ControlInstance,
} from "./model";
import { isSliderValueAccepted } from "./tasks";
import type { RoomView } from "./room";

const PLAYERS = ["p1", "p2", "p3"];
const panelFor = (seed: string, players = PLAYERS) =>
  generatePanels(players, createRng(seed));

/** Build the intent that satisfies an instruction, for tests. */
function satisfyingIntent(
  control: ControlInstance,
  expected: ExpectedOutcome,
): Intent {
  switch (expected.kind) {
    case "press":
      return { type: "press", controlId: control.id };
    case "toggle":
      return { type: "set", controlId: control.id, value: expected.on };
    case "direction":
      return { type: "set", controlId: control.id, value: expected.value };
    case "select":
      return { type: "set", controlId: control.id, value: expected.value };
    case "slider":
      return {
        type: "set",
        controlId: control.id,
        value: expected.task.targetValue,
      };
    case "dial":
      return { type: "set", controlId: control.id, value: expected.position };
  }
}

describe("generatePanels (Stage 4)", () => {
  it("gives every player 4–6 controls of the six game types, owner set", () => {
    const controls = panelFor("panels");
    for (const pid of PLAYERS) {
      const mine = controls.filter((c) => c.ownerPlayerId === pid);
      expect(mine.length).toBeGreaterThanOrEqual(MIN_PANEL_CONTROLS);
      expect(mine.length).toBeLessThanOrEqual(MAX_PANEL_CONTROLS);
      for (const c of mine) expect(GAME_TYPES).toContain(c.definition.kind);
    }
  });

  it("uses globally unique labels and ids", () => {
    const controls = panelFor("uniq", ["a", "b", "c", "d"]);
    expect(hasUniqueLabels(controls)).toBe(true);
    expect(new Set(controls.map((c) => c.id)).size).toBe(controls.length);
  });

  it("is deterministic for a seed", () => {
    expect(JSON.stringify(panelFor("s"))).toBe(JSON.stringify(panelFor("s")));
  });

  it("balances panels by total complexity, not by control count", () => {
    let spreadMax = 0;
    for (let s = 0; s < 40; s++) {
      const controls = panelFor(`bal${s}`, ["a", "b", "c", "d"]);
      const totals = ["a", "b", "c", "d"].map((pid) =>
        getPanelComplexity(controls.filter((c) => c.ownerPlayerId === pid)),
      );
      const sizes = ["a", "b", "c", "d"].map(
        (pid) => controls.filter((c) => c.ownerPlayerId === pid).length,
      );
      // every panel lands in the greedy target-ish band
      for (const t of totals) expect(t).toBeGreaterThanOrEqual(10);
      spreadMax = Math.max(spreadMax, Math.max(...totals) - Math.min(...totals));
      // sizes may vary (that's the point) but stay in range
      for (const n of sizes) {
        expect(n).toBeGreaterThanOrEqual(MIN_PANEL_CONTROLS);
        expect(n).toBeLessThanOrEqual(MAX_PANEL_CONTROLS);
      }
    }
    expect(spreadMax).toBeLessThanOrEqual(8); // small band
  });

  it("produces different panels for different players", () => {
    const controls = panelFor("diff", ["a", "b"]);
    const a = controls.filter((c) => c.ownerPlayerId === "a").map((c) => c.label);
    const b = controls.filter((c) => c.ownerPlayerId === "b").map((c) => c.label);
    expect(a).not.toEqual(b);
  });
});

describe("generateInstructions", () => {
  it("makes exactly one active instruction per player, label verbatim in text", () => {
    const controls = panelFor("ins");
    const ins = generateInstructions(PLAYERS, controls, createRng("ins"));
    expect(ins).toHaveLength(PLAYERS.length);
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

  it("recipient and target owner are independent — both occur, self is the minority", () => {
    let same = 0;
    let diff = 0;
    for (let s = 0; s < 150; s++) {
      const controls = panelFor(`indep${s}`);
      for (const i of generateInstructions(PLAYERS, controls, createRng(`i${s}`))) {
        const owner = controls.find((c) => c.id === i.controlId)!.ownerPlayerId;
        if (owner === i.shownToPlayerId) same++;
        else diff++;
      }
    }
    expect(same).toBeGreaterThan(0);
    expect(diff).toBeGreaterThan(0);
    expect(same).toBeLessThan(diff);
  });

  it("no owner is starved or flooded when many instructions are live", () => {
    const players = ["a", "b", "c", "d"];
    const controls = panelFor("flood", players);
    const active: Instruction[] = [];
    for (let k = 0; k < 12; k++) {
      const r = players[k % players.length]!;
      active.push(nextInstruction(r, players, controls, active, createRng(`f${k}`)));
    }
    const perOwner = new Map<string, number>();
    for (const i of active) {
      const o = controls.find((c) => c.id === i.controlId)!.ownerPlayerId!;
      perOwner.set(o, (perOwner.get(o) ?? 0) + 1);
    }
    const counts = players.map((p) => perOwner.get(p) ?? 0);
    expect(Math.min(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });

  it("avoidControlId keeps the just-completed control from being re-picked", () => {
    const controls = panelFor("avoid", ["a", "b"]);
    let repeats = 0;
    for (let s = 0; s < 60; s++) {
      const avoid = controls[s % controls.length]!;
      const ins = nextInstruction(
        "a",
        ["a", "b"],
        controls,
        [],
        createRng(`av${s}`),
        avoid.id,
      );
      if (ins.controlId === avoid.id) repeats++;
    }
    expect(repeats).toBe(0);
  });
});

describe("instructionText", () => {
  const t = (e: ExpectedOutcome) => instructionText("КОНТРОЛ", e);
  it("renders each expectation kind", () => {
    expect(t({ kind: "press", fromCount: 0 })).toBe("КОНТРОЛ → НАЖАТЬ");
    expect(t({ kind: "toggle", on: true })).toBe("КОНТРОЛ → ВКЛ");
    expect(t({ kind: "direction", value: "ВЛЕВО" })).toBe("КОНТРОЛ → ВЛЕВО");
    expect(t({ kind: "select", value: "◆" })).toBe("КОНТРОЛ → ◆");
    expect(t({ kind: "slider", task: { targetValue: 67, tolerance: 3 } })).toBe(
      "КОНТРОЛ → 67 ± 3",
    );
    expect(t({ kind: "dial", position: 5 })).toBe("КОНТРОЛ → 6");
  });
});

describe("validateIntent — all six types", () => {
  // Build a synthetic game with one control of each type owned by "me".
  const build = (seed: string) => {
    const controls = panelFor(seed, ["me", "other"]);
    const mine = controls.filter((c) => c.ownerPlayerId === "me");
    return { controls, mine };
  };

  it("completes an instruction for every control kind when the owner acts", () => {
    for (let s = 0; s < 30; s++) {
      const { controls, mine } = build(`v${s}`);
      for (const control of mine) {
        const instructions: Instruction[] = [];
        // craft an instruction targeting this control, shown to "other"
        const ins = nextInstruction(
          "other",
          ["me", "other"],
          [control],
          [],
          createRng(`x${s}${control.id}`),
        );
        instructions.push(ins);
        const game = { controls, instructions };
        const res = validateIntent(
          game,
          "me",
          satisfyingIntent(control, ins.expected),
        );
        expect(res.ok).toBe(true);
        expect(res.completedInstructionId).toBe(ins.id);
      }
    }
  });

  it("slider: only a value inside tolerance completes", () => {
    const { mine } = build("sl");
    const slider = mine.find((c) => c.definition.kind === "slider");
    if (!slider) return;
    const task = { targetValue: 60, tolerance: 5 };
    const ins: Instruction = {
      id: "i1",
      controlId: slider.id,
      controlLabel: slider.label,
      shownToPlayerId: "other",
      expected: { kind: "slider", task },
      text: instructionText(slider.label, { kind: "slider", task }),
      status: "active",
    };
    const game = { controls: [slider], instructions: [ins] };
    expect(
      validateIntent(game, "me", { type: "set", controlId: slider.id, value: 54 })
        .completedInstructionId,
    ).toBeUndefined();
    expect(
      validateIntent(game, "me", { type: "set", controlId: slider.id, value: 55 })
        .completedInstructionId,
    ).toBe("i1");
    expect(isSliderValueAccepted(65, task)).toBe(true);
  });

  it("rejects an intent from a non-owner", () => {
    const { controls, mine } = build("own");
    const c = mine[0]!;
    const res = validateIntent(
      { controls, instructions: [] },
      "other",
      { type: "press", controlId: c.id },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_owner");
  });
});

describe("buildPlayerView", () => {
  it("returns only the player's own panel and instructions", () => {
    const controls = panelFor("view");
    const instructions = generateInstructions(PLAYERS, controls, createRng("view"));
    const room = {
      code: "BCDF",
      phase: "playing",
      players: [],
      protocolVersion: 1,
    } as RoomView;
    const view = buildPlayerView(room, "p2", { controls, instructions });
    expect(view.panel.every((c) => c.ownerPlayerId === "p2")).toBe(true);
    expect(view.instructions.every((i) => i.shownToPlayerId === "p2")).toBe(true);
    expect(view.you).toBe("p2");
  });
});

// keep CONTROL_COMPLEXITY imported check meaningful
it("every game type has a positive complexity", () => {
  for (const t of GAME_TYPES) expect(CONTROL_COMPLEXITY[t]).toBeGreaterThan(0);
});
