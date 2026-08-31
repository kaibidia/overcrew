import { describe, it, expect } from "vitest";
import { createRng } from "./rng";
import {
  GAME_TYPES,
  MAX_PANEL_CONTROLS,
  MIN_PANEL_CONTROLS,
  buildPlayerView,
  difficultyFor,
  generateInstructions,
  generatePanels,
  instructionText,
  levelForElapsed,
  nextInstruction,
  validateIntent,
  type ExpectedOutcome,
  type Instruction,
  type Intent,
  type ShipView,
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
const insOpts = { deadlineAt: 1_000_000, totalMs: 20_000 };
const genIns = (controls: readonly ControlInstance[], seed: string, players = PLAYERS) =>
  generateInstructions(players, controls, createRng(seed), {
    now: 0,
    deadlineMs: 20_000,
  });

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
      for (const t of totals) expect(t).toBeGreaterThanOrEqual(10);
      spreadMax = Math.max(spreadMax, Math.max(...totals) - Math.min(...totals));
    }
    expect(spreadMax).toBeLessThanOrEqual(8);
  });

  it("produces different panels for different players", () => {
    const controls = panelFor("diff", ["a", "b"]);
    const a = controls.filter((c) => c.ownerPlayerId === "a").map((c) => c.label);
    const b = controls.filter((c) => c.ownerPlayerId === "b").map((c) => c.label);
    expect(a).not.toEqual(b);
  });
});

describe("difficulty ramp (Stage 5)", () => {
  it("levels up every 20s of play", () => {
    expect(levelForElapsed(0)).toBe(1);
    expect(levelForElapsed(19_999)).toBe(1);
    expect(levelForElapsed(20_000)).toBe(2);
    expect(levelForElapsed(200_000)).toBe(11);
  });

  it("gets harder with level: shorter deadlines, more instructions, bigger penalty", () => {
    const d1 = difficultyFor(1);
    const d6 = difficultyFor(6);
    expect(d1.deadlineMs).toBeGreaterThan(d6.deadlineMs);
    expect(d6.deadlineMs).toBeGreaterThanOrEqual(6_000); // floor
    expect(d1.instructionsPerPlayer).toBe(1);
    expect(d6.instructionsPerPlayer).toBe(3);
    expect(d6.expirePenalty).toBeGreaterThan(d1.expirePenalty);
  });
});

describe("generateInstructions", () => {
  it("makes one active instruction per player with a deadline, label verbatim in text", () => {
    const controls = panelFor("ins");
    const ins = genIns(controls, "ins");
    expect(ins).toHaveLength(PLAYERS.length);
    for (const i of ins) {
      expect(i.text).toContain(i.controlLabel);
      expect(i.deadlineAt).toBe(20_000);
      expect(i.totalMs).toBe(20_000);
      expect(controls.some((c) => c.id === i.controlId)).toBe(true);
    }
  });

  it("never points two active instructions at the same control", () => {
    const controls = panelFor("dup");
    const ins = genIns(controls, "dup");
    expect(new Set(ins.map((i) => i.controlId)).size).toBe(ins.length);
  });

  it("recipient and target owner are independent — both occur, self is the minority", () => {
    let same = 0;
    let diff = 0;
    for (let s = 0; s < 150; s++) {
      const controls = panelFor(`indep${s}`);
      for (const i of genIns(controls, `i${s}`)) {
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
      active.push(
        nextInstruction(r, players, controls, active, createRng(`f${k}`), insOpts),
      );
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
      const ins = nextInstruction("a", ["a", "b"], controls, [], createRng(`av${s}`), {
        ...insOpts,
        avoidControlId: avoid.id,
      });
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
  const build = (seed: string) => {
    const controls = panelFor(seed, ["me", "other"]);
    return { controls, mine: controls.filter((c) => c.ownerPlayerId === "me") };
  };

  it("completes an instruction for every control kind when the owner acts", () => {
    for (let s = 0; s < 30; s++) {
      const { controls, mine } = build(`v${s}`);
      for (const control of mine) {
        const ins = nextInstruction(
          "other",
          ["me", "other"],
          [control],
          [],
          createRng(`x${s}${control.id}`),
          insOpts,
        );
        const res = validateIntent(
          { controls, instructions: [ins] },
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
      deadlineAt: 1_000_000,
      totalMs: 20_000,
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
    const res = validateIntent({ controls, instructions: [] }, "other", {
      type: "press",
      controlId: c.id,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not_owner");
  });
});

describe("buildPlayerView", () => {
  const ship: ShipView = {
    health: 80,
    maxHealth: 100,
    progress: 3,
    level: 2,
    elapsedMs: 25_000,
    phase: "playing",
  };
  it("returns only the player's own panel, instructions (as views) and the ship", () => {
    const controls = panelFor("view");
    const instructions = generateInstructions(PLAYERS, controls, createRng("view"), {
      now: 10_000,
      deadlineMs: 18_000,
    });
    const room = {
      code: "BCDF",
      phase: "playing",
      players: [],
      protocolVersion: 1,
    } as RoomView;
    const view = buildPlayerView(room, "p2", { controls, instructions }, {
      ship,
      now: 12_000,
    });
    expect(view.panel.every((c) => c.ownerPlayerId === "p2")).toBe(true);
    expect(view.you).toBe("p2");
    expect(view.ship.health).toBe(80);
    for (const i of view.instructions) {
      expect(i.remainingMs).toBeGreaterThan(0);
      expect(i.remainingMs).toBeLessThanOrEqual(18_000);
      expect("deadlineAt" in i).toBe(false); // absolute timestamp not leaked
    }
  });
});

it("every game type has a positive complexity", () => {
  for (const t of GAME_TYPES) expect(CONTROL_COMPLEXITY[t]).toBeGreaterThan(0);
});
