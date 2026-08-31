/**
 * Stage 3 game model: panels, instructions, intent validation.
 *
 * Core invariant (DECISIONS D11, master prompt §14): an instruction's
 * `shownToPlayerId` and its target control's `ownerPlayerId` are chosen
 * INDEPENDENTLY. A minority (~1 in 5) land on a control the recipient owns; this
 * is never special-cased. Every instruction's text contains the control's label
 * verbatim so it can be shouted.
 *
 * Stage 3 uses three control types only: button, toggle, shapeSelector.
 * All completion is decided by the server via `validateIntent` — pure, no
 * mutation. Clients only send intent.
 */
import type { Rng } from "./rng";
import {
  SHAPES,
} from "./panel";
import { instantiateControl, namesForType } from "./names";
import type {
  ControlDefinition,
  ControlInstance,
  ControlState,
  ControlType,
} from "./model";
import type { RoomView } from "./room";

export const STAGE3_TYPES: readonly ControlType[] = [
  "button",
  "toggle",
  "shapeSelector",
];

/** ~1 in 5 instructions target a control the recipient owns. Never special-cased. */
export const SELF_TARGET_CHANCE = 0.2;

// --- Instructions ---------------------------------------------------------

export type ExpectedOutcome =
  | { kind: "press"; fromCount: number }
  | { kind: "toggle"; on: boolean }
  | { kind: "select"; value: string | number };

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

function definitionFor(type: ControlType): ControlDefinition {
  switch (type) {
    case "button":
      return { kind: "button" };
    case "toggle":
      return { kind: "toggle" };
    case "shapeSelector":
      return { kind: "shapeSelector", values: [...SHAPES] };
    default:
      throw new Error(`Stage 3 does not support control type: ${type}`);
  }
}

/** Names dedicated to exactly one type (keeps multi-type names for their niche). */
function dedicatedNames(type: ControlType) {
  return namesForType(type).filter((n) => n.compatibleTypes.length === 1);
}

/**
 * One panel per player. Prefers one of each Stage 3 type; when a name pool for a
 * type runs dry it borrows from another type (repeated types are fine —
 * DECISIONS D17). All labels are globally unique.
 */
export function generatePanels(
  playerIds: readonly string[],
  rng: Rng,
): ControlInstance[] {
  const pools = new Map(
    STAGE3_TYPES.map((t) => [t, rng.shuffle(dedicatedNames(t))]),
  );
  const totalNames = [...pools.values()].reduce((n, p) => n + p.length, 0);
  const perPlayer = Math.max(
    2,
    Math.min(3, Math.floor(totalNames / Math.max(1, playerIds.length))),
  );

  const controls: ControlInstance[] = [];
  let seq = 0;
  for (const pid of playerIds) {
    const wanted = rng.shuffle(STAGE3_TYPES);
    for (let slot = 0; slot < perPlayer; slot++) {
      let type = wanted[slot % wanted.length] as ControlType;
      if ((pools.get(type)?.length ?? 0) === 0) {
        const alt = STAGE3_TYPES.find((t) => (pools.get(t)?.length ?? 0) > 0);
        if (!alt) throw new Error("Ran out of control names for this game");
        type = alt;
      }
      const name = pools.get(type)!.pop()!;
      controls.push(
        instantiateControl(`ctl_${++seq}`, name.id, definitionFor(type), pid),
      );
    }
  }
  return controls;
}

// --- Instruction generation ------------------------------------------

function randomExpected(control: ControlInstance, rng: Rng): ExpectedOutcome {
  const def = control.definition;
  const st = control.state;
  if (def.kind === "button") {
    return { kind: "press", fromCount: st.kind === "button" ? st.pressCount : 0 };
  }
  if (def.kind === "toggle") {
    const cur = st.kind === "toggle" ? st.on : false;
    return { kind: "toggle", on: !cur };
  }
  if (def.kind === "shapeSelector") {
    const cur = st.kind === "shapeSelector" ? st.value : def.values[0];
    const others = def.values.filter((v) => v !== cur);
    return {
      kind: "select",
      value: rng.pick(others.length ? others : def.values),
    };
  }
  throw new Error(`No Stage 3 expectation for ${def.kind}`);
}

export function instructionText(label: string, expected: ExpectedOutcome): string {
  switch (expected.kind) {
    case "press":
      return `${label} → НАЖАТЬ`;
    case "toggle":
      return `${label} → ${expected.on ? "ВКЛ" : "ВЫКЛ"}`;
    case "select":
      return `${label} → ${expected.value}`;
  }
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Build one instruction for `recipientId`. Target owner is chosen independently
 * of the recipient (self only ~SELF_TARGET_CHANCE of the time), then balanced so
 * the owner with the fewest instructions currently pointed at them is preferred.
 * Controls already targeted by an active instruction are skipped.
 */
export function nextInstruction(
  recipientId: string,
  playerIds: readonly string[],
  controls: readonly ControlInstance[],
  activeInstructions: readonly Instruction[],
  rng: Rng,
): Instruction {
  const targeted = new Set(activeInstructions.map((i) => i.controlId));
  const load = new Map<string, number>();
  for (const ins of activeInstructions) {
    const owner = controls.find((c) => c.id === ins.controlId)?.ownerPlayerId;
    if (owner) load.set(owner, (load.get(owner) ?? 0) + 1);
  }

  // Recipient and target owner are independent: self only ~SELF_TARGET_CHANCE of
  // the time, otherwise explicitly someone else.
  const allowSelf = rng.next() < SELF_TARGET_CHANCE;
  const allowedOwners = allowSelf
    ? [recipientId]
    : playerIds.filter((p) => p !== recipientId);

  let candidates = controls.filter(
    (c) =>
      c.ownerPlayerId !== undefined &&
      allowedOwners.includes(c.ownerPlayerId) &&
      !targeted.has(c.id),
  );
  if (candidates.length === 0)
    candidates = controls.filter((c) => !targeted.has(c.id));
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

export function applyIntentToControl(
  control: ControlInstance,
  intent: Intent,
): ControlState {
  const def = control.definition;
  if (intent.type === "press" && def.kind === "button") {
    const count =
      control.state.kind === "button" ? control.state.pressCount : 0;
    return { kind: "button", pressCount: count + 1 };
  }
  if (intent.type === "set") {
    if (def.kind === "toggle" && typeof intent.value === "boolean") {
      return { kind: "toggle", on: intent.value };
    }
    if (
      def.kind === "shapeSelector" &&
      (typeof intent.value === "string" || typeof intent.value === "number")
    ) {
      return { kind: "shapeSelector", value: intent.value };
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
    case "select":
      return state.kind === "shapeSelector" && state.value === expected.value;
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
