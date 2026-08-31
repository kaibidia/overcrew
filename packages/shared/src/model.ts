/**
 * Core data model for Overcrew.
 *
 * Four concepts are kept deliberately separate (docs/GAME_MODEL.md, DECISIONS
 * D8 / D21):
 *
 *   1. ControlType       — the interaction (button, toggle, dial, …). Mechanic only.
 *   2. ControlName        — a curated visible label + which types it may take
 *                           (see names.ts). Players identify controls by this.
 *   3. ControlInstance    — a concrete generated control: a name + a type + params
 *                           + current value, optionally owned by a player.
 *   4. ControlComplexity  — a 1–10 score attached to the TYPE, not the name.
 *
 * There is NO assumption that one type maps to one name. A match may hold ~24
 * instances across 4 players; many may share a type as long as their visible
 * labels are unique (see hasUniqueLabels).
 *
 * Stage 1 exercises the interaction only. `hold`/`mash` multiplayer semantics
 * arrive in Stages 6/7.
 */

export type ControlType =
  | "button"
  | "toggle"
  | "direction"
  | "shapeSelector"
  | "slider"
  | "dial"
  | "hold"
  | "mash";

export const CONTROL_TYPES: readonly ControlType[] = [
  "button",
  "toggle",
  "direction",
  "shapeSelector",
  "slider",
  "dial",
  "hold",
  "mash",
];

/**
 * Base complexity of an interaction TYPE on a 1–10 scale: roughly how much
 * attention and physical interaction one control demands of one player.
 *
 * It belongs to the type, never to a sci-fi name — КРИОКЛАПАН is complexity 2
 * only because it is currently instantiated as a `toggle`.
 *
 * This is NOT task difficulty. Deadlines, concurrent tasks, synchronized
 * multiplayer actions and critical events are separate and must not be folded
 * into this number.
 *
 * The scale is 1–10 (not 1–7) so future interaction types can slot in higher.
 */
export const CONTROL_COMPLEXITY: Record<ControlType, number> = {
  button: 1,
  toggle: 2,
  direction: 3,
  shapeSelector: 3,
  slider: 5,
  dial: 5,
  hold: 6,
  mash: 7,
};

export const DIRECTIONS = ["ВВЕРХ", "ВНИЗ", "ВЛЕВО", "ВПРАВО"] as const;
export type Direction = (typeof DIRECTIONS)[number];

// --- Control definitions (mechanic + params; `kind` is the ControlType) -------

export interface ButtonDefinition {
  kind: "button";
}
export interface ToggleDefinition {
  kind: "toggle";
}
export interface ShapeSelectorDefinition {
  kind: "shapeSelector";
  /** Ordered choices shown all at once, e.g. the shape glyphs ● ▲ ■ ◆. */
  values: ReadonlyArray<string | number>;
}
export interface DirectionDefinition {
  kind: "direction";
}
export interface DialDefinition {
  kind: "dial";
  /** Discrete positions. Stored 0-indexed; presented 1-indexed (1..positions). */
  positions: number;
}
export interface SliderDefinition {
  kind: "slider";
  min: number;
  max: number;
  /** Discrete step. Early prototypes avoid pixel-perfect values. */
  step: number;
}
export interface HoldDefinition {
  kind: "hold";
  /** How long the control must be held to complete, in milliseconds. */
  durationMs: number;
}
export interface MashDefinition {
  kind: "mash";
  /** Number of taps required to complete. */
  targetTaps: number;
}

export type ControlDefinition =
  | ButtonDefinition
  | ToggleDefinition
  | ShapeSelectorDefinition
  | DirectionDefinition
  | DialDefinition
  | SliderDefinition
  | HoldDefinition
  | MashDefinition;

// --- Control state (current value; `kind` matches the definition) -------------

export type ControlState =
  | { kind: "button"; pressCount: number }
  | { kind: "toggle"; on: boolean }
  | { kind: "shapeSelector"; value: string | number }
  | { kind: "direction"; value: Direction | null }
  | { kind: "dial"; position: number }
  | { kind: "slider"; value: number }
  | { kind: "hold"; completed: boolean }
  | { kind: "mash"; taps: number };

/** The starting state for a freshly created control. */
export function initialState(def: ControlDefinition): ControlState {
  switch (def.kind) {
    case "button":
      return { kind: "button", pressCount: 0 };
    case "toggle":
      return { kind: "toggle", on: false };
    case "shapeSelector":
      return { kind: "shapeSelector", value: def.values[0] ?? 0 };
    case "direction":
      return { kind: "direction", value: null };
    case "dial":
      return { kind: "dial", position: 0 };
    case "slider":
      return { kind: "slider", value: def.min };
    case "hold":
      return { kind: "hold", completed: false };
    case "mash":
      return { kind: "mash", taps: 0 };
  }
}

// --- Control instances -------------------------------------------------------

export interface ControlInstance {
  id: string;
  /** References a ControlNameDef.id in the name registry (names.ts). */
  nameId: string;
  /** Visible name players shout. Denormalized from the name registry. */
  label: string;
  /** Mechanic + params. `definition.kind` is the ControlType. */
  definition: ControlDefinition;
  /** Owner player. Optional: unassigned in the Stage 1 local playground. */
  ownerPlayerId?: string;
  /** Current value. */
  state: ControlState;
}

/** The interaction type of a control instance. */
export function controlType(control: ControlInstance): ControlType {
  return control.definition.kind;
}

interface CreateControlName {
  nameId: string;
  label: string;
}

/**
 * Low-level constructor. Does not consult the name registry — callers pass a
 * resolved `{ nameId, label }`. Use `instantiateControl` (names.ts) for the
 * registry-aware version that also checks type compatibility.
 */
export function createControl(
  id: string,
  name: CreateControlName,
  definition: ControlDefinition,
  ownerPlayerId?: string,
): ControlInstance {
  return {
    id,
    nameId: name.nameId,
    label: name.label,
    definition,
    ...(ownerPlayerId !== undefined ? { ownerPlayerId } : {}),
    state: initialState(definition),
  };
}

// --- Panel-level helpers -----------------------------------------------------

/**
 * Total complexity of a player's panel = the sum of its controls' TYPE
 * complexity. A future generator balances players by keeping these totals close
 * — not by giving everyone the same control count. One player may hold 4 heavy
 * controls while another holds 6 light ones with a similar total.
 */
export function getPanelComplexity(controls: readonly ControlInstance[]): number {
  return controls.reduce(
    (sum, c) => sum + CONTROL_COMPLEXITY[c.definition.kind],
    0,
  );
}

/** Visible labels that appear more than once in the given set. */
export function duplicateLabels(controls: readonly ControlInstance[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const c of controls) {
    if (seen.has(c.label)) dupes.add(c.label);
    seen.add(c.label);
  }
  return [...dupes];
}

/**
 * Within one active game every control's visible name must be unique — players
 * coordinate by shouting the name, so two live КРИОКЛАПАН controls are illegal.
 * (Different matches may reuse names freely.)
 */
export function hasUniqueLabels(controls: readonly ControlInstance[]): boolean {
  return duplicateLabels(controls).length === 0;
}
