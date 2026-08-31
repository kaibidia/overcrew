/**
 * The Stage 1 playground panel: one concrete instance of each of the eight V1
 * interaction types, using the current example names.
 *
 * These are EXAMPLE INSTANCES, not type definitions — the same interaction can
 * be instantiated under many different names (see names.ts, model.ts). There is
 * no generation or balancing here; a real 4-player panel generator (Stage 4)
 * will build 4–6-control panels balanced by getPanelComplexity().
 */
import { instantiateControl } from "./names";
import type { ControlInstance } from "./model";
import type { SliderTask } from "./tasks";

/** Geometric shape values for a shapeSelector. The value is the shape itself. */
export const SHAPES = ["●", "▲", "■", "◆"] as const;

/** Demo slider instruction for the playground: ДАВЛЕНИЕ → 67 ± 3 (64..70 valid). */
export const DEMO_SLIDER_TASK: SliderTask = { targetValue: 67, tolerance: 3 };

export function createSamplePanel(): ControlInstance[] {
  return [
    instantiateControl("c1", "plazmonasos", { kind: "button" }),
    instantiateControl("c2", "krioklapan", { kind: "toggle" }),
    instantiateControl("c3", "giroskop", { kind: "direction" }),
    instantiateControl("c4", "turbozhaba", {
      kind: "shapeSelector",
      values: [...SHAPES],
    }),
    instantiateControl("c5", "davlenie", {
      kind: "slider",
      min: 0,
      max: 100,
      step: 1,
    }),
    instantiateControl("c6", "fazovrashchatel", { kind: "dial", positions: 8 }),
    instantiateControl("c7", "stabilizator", { kind: "hold", durationMs: 2000 }),
    instantiateControl("c8", "impulsator", { kind: "mash", targetTaps: 12 }),
  ];
}
