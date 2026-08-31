import { describe, it, expect } from "vitest";
import {
  BUTTON_NAMES,
  CONTROL_NAMES,
  getControlName,
  instantiateControl,
  isCompatible,
  namesForType,
} from "./names";
import { createSamplePanel, SHAPES } from "./panel";
import { CONTROL_TYPES, getPanelComplexity, hasUniqueLabels } from "./model";

describe("name registry", () => {
  it("every name has a non-empty label and at least one compatible type", () => {
    for (const n of CONTROL_NAMES) {
      expect(n.label.trim().length).toBeGreaterThan(0);
      expect(n.compatibleTypes.length).toBeGreaterThanOrEqual(1);
      for (const t of n.compatibleTypes) expect(CONTROL_TYPES).toContain(t);
    }
  });

  it("name ids and labels are unique across the registry", () => {
    expect(new Set(CONTROL_NAMES.map((n) => n.id)).size).toBe(CONTROL_NAMES.length);
    expect(new Set(CONTROL_NAMES.map((n) => n.label)).size).toBe(CONTROL_NAMES.length);
  });

  it("supports a name with multiple compatible types", () => {
    expect(getControlName("davlenie")?.compatibleTypes).toEqual(["slider", "dial"]);
    expect(getControlName("fazovrashchatel")?.compatibleTypes).toEqual([
      "dial",
      "toggle",
    ]);
    expect(isCompatible("fazovrashchatel", "toggle")).toBe(true);
    expect(isCompatible("davlenie", "mash")).toBe(false);
  });

  it("namesForType returns every name that lists the type", () => {
    expect(namesForType("button").map((n) => n.id).sort()).toEqual(
      BUTTON_NAMES.map((n) => n.id).sort(),
    );
    expect(namesForType("dial").map((n) => n.id)).toContain("fazovrashchatel");
    expect(namesForType("dial").map((n) => n.id)).toContain("davlenie");
  });
});

describe("button pool", () => {
  it("starts with the five originally-approved names", () => {
    expect(BUTTON_NAMES.slice(0, 5).map((n) => n.label)).toEqual([
      "ПЛАЗМОНАСОС",
      "АВАРИЙНЫЙ СБРОС",
      "ИОННЫЙ ПУСКАТЕЛЬ",
      "КВАНТОВЫЙ ЗВОНОК",
      "ТУРБОСТАРТЕР",
    ]);
  });

  it("all names instantiate the same reusable button interaction", () => {
    const buttons = BUTTON_NAMES.map((n, i) =>
      instantiateControl(`b${i}`, n.id, { kind: "button" }),
    );
    expect(buttons.every((b) => b.definition.kind === "button")).toBe(true);
    expect(buttons.map((b) => b.label)).toEqual(BUTTON_NAMES.map((n) => n.label));
    expect(hasUniqueLabels(buttons)).toBe(true);
  });
});

describe("instantiateControl", () => {
  it("resolves the label from the name id", () => {
    const c = instantiateControl("x", "krioklapan", { kind: "toggle" });
    expect(c.label).toBe("КРИОКЛАПАН");
    expect(c.nameId).toBe("krioklapan");
  });

  it("rejects an unknown name id", () => {
    expect(() => instantiateControl("x", "nope", { kind: "button" })).toThrow();
  });

  it("rejects a definition whose type the name does not allow", () => {
    expect(() =>
      instantiateControl("x", "krioklapan", { kind: "mash", targetTaps: 12 }),
    ).toThrow(/cannot be a mash/);
  });

  it("accepts either compatible type for a multi-type name", () => {
    expect(() =>
      instantiateControl("a", "fazovrashchatel", { kind: "dial", positions: 8 }),
    ).not.toThrow();
    expect(() =>
      instantiateControl("b", "fazovrashchatel", { kind: "toggle" }),
    ).not.toThrow();
  });
});

describe("Stage 1 sample panel", () => {
  const panel = createSamplePanel();

  it("shows one instance of each of the eight V1 types", () => {
    expect(panel.map((c) => c.definition.kind).sort()).toEqual(
      [...CONTROL_TYPES].sort(),
    );
  });

  it("has unique visible names and ids", () => {
    expect(hasUniqueLabels(panel)).toBe(true);
    expect(new Set(panel.map((c) => c.id)).size).toBe(panel.length);
  });

  it("keeps ТУРБОЖАБА a shape selector (● ▲ ■ ◆), ФАЗОВРАЩАТЕЛЬ an 8-position dial", () => {
    const turbo = panel.find((c) => c.label === "ТУРБОЖАБА");
    expect(turbo?.definition).toEqual({
      kind: "shapeSelector",
      values: [...SHAPES],
    });
    expect(panel.find((c) => c.label === "ФАЗОВРАЩАТЕЛЬ")?.definition).toEqual({
      kind: "dial",
      positions: 8,
    });
  });

  it("ДАВЛЕНИЕ is an integer slider over 0..100 (step 1)", () => {
    expect(panel.find((c) => c.label === "ДАВЛЕНИЕ")?.definition).toEqual({
      kind: "slider",
      min: 0,
      max: 100,
      step: 1,
    });
  });

  it("has a well-defined total complexity (1+2+3+3+5+5+6+7 = 32)", () => {
    expect(getPanelComplexity(panel)).toBe(32);
  });
});
