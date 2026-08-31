/**
 * Game model: panels, instructions, intent validation.
 *
 * Core invariant (DECISIONS D11, master prompt §14): an instruction's
 * `shownToPlayerId` and its target control's `ownerPlayerId` are chosen
 * INDEPENDENTLY. A minority (~1 in 5) land on a control the recipient owns; this
 * is never special-cased. Every instruction's text contains the control's label
 * verbatim so it can be shouted.
 *
 * Stage 4: six control types (button, toggle, direction, shapeSelector, slider,
 * dial). Panels are 4–6 controls, randomised, balanced by total
 * `getPanelComplexity` rather than by count. `hold`/`mash` are Stages 6/7.
 *
 * All completion is decided by the server via `validateIntent` — pure, no
 * mutation. Clients only send intent.
 */
import type { Rng } from "./rng";
import { SHAPES } from "./panel";
import { instantiateControl, namesForType } from "./names";
import {
  CONTROL_COMPLEXITY,
  DIRECTIONS,
  type ControlDefinition,
  type ControlInstance,
  type ControlState,
  type ControlType,
  type Direction,
} from "./model";
import {
  SLIDER_MAX,
  SLIDER_MIN,
  formatSliderTask,
  isSliderValueAccepted,
  type SliderTask,
} from "./tasks";
import type { RoomView } from "./room";

/** Control types that can appear in a generated panel (button..dial). */
export const GAME_TYPES: readonly ControlType[] = [
  "button",
  "toggle",
  "direction",
  "shapeSelector",
  "slider",
  "dial",
];

/** ~1 in 5 instructions target a control the recipient owns. Never special-cased. */
export const SELF_TARGET_CHANCE = 0.2;

export const MIN_PANEL_CONTROLS = 4;
export const MAX_PANEL_CONTROLS = 6;
/** Greedy fill stops here (once ≥ MIN_PANEL_CONTROLS) — see generatePanels. */
export const TARGET_PANEL_COMPLEXITY = 15;

// --- Instructions ---------------------------------------------------------

export type ExpectedOutcome =
  | { kind: "press"; fromCount: number }
  | { kind: "toggle"; on: boolean }
  | { kind: "direction"; value: Direction }
  | { kind: "select"; value: string | number }
  | { kind: "slider"; task: SliderTask }
  | { kind: "dial"; position: number };

export interface Instruction {
  id: string;
  controlId: string;
  /** Denormalized so text/UI never needs a lookup. Appears verbatim in `text`. */
  controlLabel: string;
  shownToPlayerId: string;
  expected: ExpectedOutcome;
  text: string;
  status: "active" | "completed";
}

export interface GameLike {
  controls: ControlInstance[];
  instructions: Instruction[];
}

/** What a single player is sent — only their own panel and their own instructions. */
export interface PlayerView {
  room: RoomView;
  you: string;
  panel: ControlInstance[];
  instructions: Instruction[];
}

// --- Intents -------------------------------------------------------------

export type Intent =
  | { type: "press"; controlId: string }
  | { type: "set"; controlId: string; value: string | number | boolean };

// --- Panel generation --------------------------------------------------

function definitionFor(type: ControlType, rng: Rng): ControlDefinition {
  switch (type) {
    case "button":
      return { kind: "button" };
    case "toggle":
      return { kind: "toggle" };
    case "direction":
      return { kind: "direction" };
    case "shapeSelector":
      return { kind: "shapeSelector", values: [...SHAPES] };
    case "slider":
      return { kind: "slider", min: SLIDER_MIN, max: SLIDER_MAX, step: 1 };
    case "dial":
      return { kind: "dial", positions: rng.pick([6, 8, 8, 10]) };
    default:
      throw new Error(`Not a generatable control type: ${type}`);
  }
}

interface GeneratePanelsOptions {
  targetComplexity?: number;
}

/**
 * One panel per player, 4–6 controls of any of the six game types. Controls are
 * added greedily (random type, random unused name) until the panel has at least
 * MIN_PANEL_CONTROLS *and* its total type-complexity reaches the target — so a
 * player may end up with 4 heavy controls or 6 light ones with a similar total
 * (master prompt §7). All labels are globally unique.
 */
export function generatePanels(
  playerIds: readonly string[],
  rng: Rng,
  opts: GeneratePanelsOptions = {},
): ControlInstance[] {
  const target = opts.targetComplexity ?? TARGET_PANEL_COMPLEXITY;
  const pools = new Map(
    GAME_TYPES.map((t) => [t, rng.shuffle(namesForType(t))]),
  );
  const used = new Set<string>();

  const takeName = (type: ControlType): string | undefined => {
    const pool = pools.get(type);
    if (!pool) return undefined;
    while (pool.length) {
      const n = pool.pop()!;
      if (!used.has(n.id)) {
        used.add(n.id);
        return n.id;
      }
    }
    return undefined;
  };

  const controls: ControlInstance[] = [];
  let seq = 0;

  /**
   * Choose the next control's type. Score = distance from the complexity we
   * still need per remaining slot, plus a penalty for types already stacked on
   * this panel (so one player doesn't get four selectors). Pick randomly from
   * the best few, then fall back to any type with a free name.
   */
  const pickType = (
    onPanel: Map<ControlType, number>,
    total: number,
    count: number,
  ): { type: ControlType; nameId: string } | undefined => {
    const slotsLeft = Math.max(1, MAX_PANEL_CONTROLS - count);
    const needPerSlot = Math.max(0.5, (target - total) / slotsLeft);
    const scored = GAME_TYPES.map((t) => ({
      t,
      score:
        Math.abs(CONTROL_COMPLEXITY[t] - needPerSlot) +
        (onPanel.get(t) ?? 0) * 2.4 +
        rng.next() * 1.2, // jitter so heavier types still show up regularly
    })).sort((a, b) => a.score - b.score);

    for (const cand of rng.shuffle(scored.slice(0, 4))) {
      const nameId = takeName(cand.t);
      if (nameId) return { type: cand.t, nameId };
    }
    for (const t of rng.shuffle(GAME_TYPES)) {
      const nameId = takeName(t);
      if (nameId) return { type: t, nameId };
    }
    return undefined;
  };

  for (const pid of playerIds) {
    let total = 0;
    let count = 0;
    const onPanel = new Map<ControlType, number>();
    while (count < MAX_PANEL_CONTROLS) {
      if (count >= MIN_PANEL_CONTROLS && total >= target) break;

      const picked = pickType(onPanel, total, count);
      if (!picked) {
        if (count >= MIN_PANEL_CONTROLS) break;
        throw new Error("Ran out of control names for this game");
      }

      controls.push(
        instantiateControl(
          `ctl_${++seq}`,
          picked.nameId,
          definitionFor(picked.type, rng),
          pid,
        ),
      );
      total += CONTROL_COMPLEXITY[picked.type];
      count += 1;
      onPanel.set(picked.type, (onPanel.get(picked.type) ?? 0) + 1);
    }
  }
  return controls;
}

// --- Instruction generation ------------------------------------------

function randomExpected(control: ControlInstance, rng: Rng): ExpectedOutcome {
  const def = control.definition;
  const st = control.state;
  switch (def.kind) {
    case "button":
      return {
        kind: "press",
        fromCount: st.kind === "button" ? st.pressCount : 0,
      };
    case "toggle":
      return { kind: "toggle", on: !(st.kind === "toggle" && st.on) };
    case "direction": {
      const cur = st.kind === "direction" ? st.value : null;
      return { kind: "direction", value: rng.pick(DIRECTIONS.filter((d) => d !== cur)) };
    }
    case "shapeSelector": {
      const cur = st.kind === "shapeSelector" ? st.value : def.values[0];
      const others = def.values.filter((v) => v !== cur);
      return { kind: "select", value: rng.pick(others.length ? others : def.values) };
    }
    case "slider": {
      const targetValue = rng.int(15, 85);
      const tolerance = rng.pick([2, 3, 5, 8, 10]);
      return { kind: "slider", task: { targetValue, tolerance } };
    }
    case "dial": {
      const cur = st.kind === "dial" ? st.position : 0;
      const all = Array.from({ length: def.positions }, (_, i) => i);
      return { kind: "dial", position: rng.pick(all.filter((p) => p !== cur)) };
    }
    default:
      throw new Error(`No expectation for control type ${def.kind}`);
  }
}

export function instructionText(label: string, expected: ExpectedOutcome): string {
  switch (expected.kind) {
    case "press":
      return `${label} → НАЖАТЬ`;
    case "toggle":
      return `${label} → ${expected.on ? "ВКЛ" : "ВЫКЛ"}`;
    case "direction":
      return `${label} → ${expected.value}`;
    case "select":
      return `${label} → ${expected.value}`;
    case "slider":
      return formatSliderTask(label, expected.task);
    case "dial":
      return `${label} → ${expected.position + 1}`;
  }
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Build one instruction for `recipientId`. Target owner is chosen independently
 * of the recipient (self only ~SELF_TARGET_CHANCE of the time), then balanced so
 * the owner with the fewest instructions currently pointed at them is preferred.
 * Controls already targeted by an active instruction — and the one just
 * completed (`avoidControlId`) — are skipped.
 */
export function nextInstruction(
  recipientId: string,
  playerIds: readonly string[],
  controls: readonly ControlInstance[],
  activeInstructions: readonly Instruction[],
  rng: Rng,
  avoidControlId?: string,
): Instruction {
  const blocked = new Set(activeInstructions.map((i) => i.controlId));
  if (avoidControlId) blocked.add(avoidControlId);

  const load = new Map<string, number>();
  for (const ins of activeInstructions) {
    const owner = controls.find((c) => c.id === ins.controlId)?.ownerPlayerId;
    if (owner) load.set(owner, (load.get(owner) ?? 0) + 1);
  }

  const allowSelf = rng.next() < SELF_TARGET_CHANCE;
  const allowedOwners = allowSelf
    ? [recipientId]
    : playerIds.filter((p) => p !== recipientId);

  let candidates = controls.filter(
    (c) =>
      c.ownerPlayerId !== undefined &&
      allowedOwners.includes(c.ownerPlayerId) &&
      !blocked.has(c.id),
  );
  if (candidates.length === 0)
    candidates = controls.filter((c) => !blocked.has(c.id));
  if (candidates.length === 0)
    candidates = controls.filter((c) => c.id !== avoidControlId);
  if (candidates.length === 0) candidates = [...controls];

  const minLoad = Math.min(
    ...candidates.map((c) => load.get(c.ownerPlayerId ?? "") ?? 0),
  );
  const balanced = candidates.filter(
    (c) => (load.get(c.ownerPlayerId ?? "") ?? 0) === minLoad,
  );

  const target = rng.pick(balanced);
  const expected = randomExpected(target, rng);
  return {
    id: newId(),
    controlId: target.id,
    controlLabel: target.label,
    shownToPlayerId: recipientId,
    expected,
    text: instructionText(target.label, expected),
    status: "active",
  };
}

/** One active instruction per player at game start. */
export function generateInstructions(
  playerIds: readonly string[],
  controls: readonly ControlInstance[],
  rng: Rng,
): Instruction[] {
  const out: Instruction[] = [];
  for (const pid of playerIds) {
    out.push(nextInstruction(pid, playerIds, controls, out, rng));
  }
  return out;
}

// --- Intent validation (pure) ---------------------------------------

const isDirection = (v: unknown): v is Direction =>
  typeof v === "string" && (DIRECTIONS as readonly string[]).includes(v);

export function applyIntentToControl(
  control: ControlInstance,
  intent: Intent,
): ControlState {
  const def = control.definition;
  if (intent.type === "press" && def.kind === "button") {
    const count = control.state.kind === "button" ? control.state.pressCount : 0;
    return { kind: "button", pressCount: count + 1 };
  }
  if (intent.type === "set") {
    const v = intent.value;
    if (def.kind === "toggle" && typeof v === "boolean") {
      return { kind: "toggle", on: v };
    }
    if (def.kind === "direction" && isDirection(v)) {
      return { kind: "direction", value: v };
    }
    if (def.kind === "shapeSelector" && (typeof v === "string" || typeof v === "number")) {
      return { kind: "shapeSelector", value: v };
    }
    if (def.kind === "slider" && typeof v === "number") {
      const clamped = Math.min(def.max, Math.max(def.min, Math.round(v)));
      return { kind: "slider", value: clamped };
    }
    if (def.kind === "dial" && typeof v === "number") {
      const pos = ((Math.round(v) % def.positions) + def.positions) % def.positions;
      return { kind: "dial", position: pos };
    }
  }
  return control.state;
}

export function expectationMet(
  expected: ExpectedOutcome,
  state: ControlState,
): boolean {
  switch (expected.kind) {
    case "press":
      return state.kind === "button" && state.pressCount > expected.fromCount;
    case "toggle":
      return state.kind === "toggle" && state.on === expected.on;
    case "direction":
      return state.kind === "direction" && state.value === expected.value;
    case "select":
      return state.kind === "shapeSelector" && state.value === expected.value;
    case "slider":
      return (
        state.kind === "slider" &&
        isSliderValueAccepted(state.value, expected.task)
      );
    case "dial":
      return state.kind === "dial" && state.position === expected.position;
  }
}

export interface IntentResult {
  ok: boolean;
  reason?: "unknown_control" | "not_owner";
  /** The control's state after the intent (unchanged if the intent was a no-op). */
  nextState?: ControlState;
  /** Id of the active instruction this intent completes, if any. */
  completedInstructionId?: string;
}

/**
 * Decide, WITHOUT mutating, what an intent does. The server applies `nextState`
 * and, if `completedInstructionId` is set, retires that instruction and issues a
 * replacement. Acting on a control with no matching instruction is a valid
 * no-op (`ok: true`, no completion) — like OpenSpaceTeam's "useless command".
 */
export function validateIntent(
  game: GameLike,
  playerId: string,
  intent: Intent,
): IntentResult {
  const control = game.controls.find((c) => c.id === intent.controlId);
  if (!control) return { ok: false, reason: "unknown_control" };
  if (control.ownerPlayerId !== playerId)
    return { ok: false, reason: "not_owner" };

  const nextState = applyIntentToControl(control, intent);
  const completed = game.instructions.find(
    (i) =>
      i.status === "active" &&
      i.controlId === control.id &&
      expectationMet(i.expected, nextState),
  );
  return {
    ok: true,
    nextState,
    ...(completed ? { completedInstructionId: completed.id } : {}),
  };
}

// --- Per-player view -------------------------------------------------

export function buildPlayerView(
  room: RoomView,
  playerId: string,
  game: GameLike,
): PlayerView {
  return {
    room,
    you: playerId,
    panel: game.controls.filter((c) => c.ownerPlayerId === playerId),
    instructions: game.instructions.filter(
      (i) => i.shownToPlayerId === playerId && i.status === "active",
    ),
  };
}
