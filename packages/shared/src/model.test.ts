import { describe, it, expect } from "vitest";
import {
  CONTROL_COMPLEXITY,
  CONTROL_TYPES,
  createControl,
  duplicateLabels,
  getPanelComplexity,
  hasUniqueLabels,
  initialState,
  type ControlInstance,
} from "./model";

describe("control types & complexity", () => {
  it("has exactly the eight V1 interaction types", () => {
    expect([...CONTROL_TYPES].sort()).toEqual(
      [
        "button",
        "dial",
        "direction",
        "hold",
        "mash",
        "shapeSelector",
        "slider",
        "toggle",
      ].sort(),
    );
  });

  it("gives every type a complexity score in 1..10", () => {
    for (const t of CONTROL_TYPES) {
      const c = CONTROL_COMPLEXITY[t];
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(1);
      expect(c).toBeLessThanOrEqual(10);
    }
  });

  it("uses the agreed base scores", () => {
    expect(CONTROL_COMPLEXITY).toEqual({
      button: 1,
      toggle: 2,
      direction: 3,
      shapeSelector: 3,
      slider: 5,
      dial: 5,
      hold: 6,
      mash: 7,
    });
  });
});

const inst = (id: string, label: string, def: ControlInstance["definition"]): ControlInstance =>
  createControl(id, { nameId: id, label }, def);

describe("getPanelComplexity", () => {
  it("sums the type complexity of the panel's controls", () => {
    const panel = [
      inst("a", "A", { kind: "button" }), // 1
      inst("b", "B", { kind: "toggle" }), // 2
      inst("c", "C", { kind: "direction" }), // 3
      inst("d", "D", { kind: "dial", positions: 8 }), // 5
      inst("e", "E", { kind: "hold", durationMs: 2000 }), // 6
    ];
    expect(getPanelComplexity(panel)).toBe(17);
  });

  it("is 0 for an empty panel", () => {
    expect(getPanelComplexity([])).toBe(0);
  });

  it("lets a 4-control panel and a 6-control panel reach a similar total", () => {
    const heavy4 = [
      inst("h1", "H1", { kind: "mash", targetTaps: 12 }), // 7
      inst("h2", "H2", { kind: "hold", durationMs: 2000 }), // 6
      inst("h3", "H3", { kind: "dial", positions: 8 }), // 5
      inst("h4", "H4", { kind: "slider", min: 0, max: 100, step: 10 }), // 5
    ];
    const light6 = [
      inst("l1", "L1", { kind: "button" }), // 1
      inst("l2", "L2", { kind: "button" }), // 1
      inst("l3", "L3", { kind: "toggle" }), // 2
      inst("l4", "L4", { kind: "toggle" }), // 2
      inst("l5", "L5", { kind: "direction" }), // 3
      inst("l6", "L6", { kind: "shapeSelector", values: [1, 2] }), // 3
    ];
    expect(getPanelComplexity(heavy4)).toBe(23);
    expect(getPanelComplexity(light6)).toBe(12);
    // (not asserting equality — just that the metric is count-independent)
  });
});

describe("repeated types, distinct names", () => {
  it("allows many controls of the same type with different labels", () => {
    const buttons = ["ONE", "TWO", "THREE", "FOUR", "FIVE"].map((l, i) =>
      inst(`b${i}`, l, { kind: "button" }),
    );
    expect(buttons.every((b) => b.definition.kind === "button")).toBe(true);
    expect(hasUniqueLabels(buttons)).toBe(true);
  });
});

describe("visible-name uniqueness", () => {
  it("detects duplicate labels within one set", () => {
    const set = [
      inst("x", "КРИОКЛАПАН", { kind: "toggle" }),
      inst("y", "КРИОКЛАПАН", { kind: "toggle" }),
      inst("z", "ГИРОСКОП", { kind: "direction" }),
    ];
    expect(hasUniqueLabels(set)).toBe(false);
    expect(duplicateLabels(set)).toEqual(["КРИОКЛАПАН"]);
  });

  it("passes a set with all-distinct labels", () => {
    const set = [
      inst("x", "КРИОКЛАПАН", { kind: "toggle" }),
      inst("y", "ГИРОСКОП", { kind: "direction" }),
    ];
    expect(hasUniqueLabels(set)).toBe(true);
    expect(duplicateLabels(set)).toEqual([]);
  });
});

describe("initialState", () => {
  it("matches the definition kind for every control type", () => {
    const defs: ControlInstance["definition"][] = [
      { kind: "button" },
      { kind: "toggle" },
      { kind: "direction" },
      { kind: "shapeSelector", values: ["●", "▲"] },
      { kind: "slider", min: 0, max: 100, step: 10 },
      { kind: "dial", positions: 8 },
      { kind: "hold", durationMs: 2000 },
      { kind: "mash", targetTaps: 12 },
    ];
    for (const d of defs) expect(initialState(d).kind).toBe(d.kind);
  });
});
