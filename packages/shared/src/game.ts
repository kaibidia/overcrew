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
 * Stage 5: instructions have deadlines; missing one drains ship health;
 * difficulty ramps with elapsed time (shorter deadlines, more concurrent
 * instructions); at 0 health it's game over. The 1 Hz loop lives on the server
 * (`apps/server/src/game.ts`).
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
import type { ScoreboardView } from "./telemetry";

/** Control types that can appear in a generated panel. `mash` is Stage 7. */
export const GAME_TYPES: readonly ControlType[] = [
  "button",
  "toggle",
  "direction",
  "shapeSelector",
  "slider",
  "dial",
  "hold",
];

/** ~1 in 5 instructions target a control the recipient owns. Never special-cased. */
export const SELF_TARGET_CHANCE = 0.2;

/** A game with ≥ 2 hold controls generates a synchronized-hold instruction this often. */
export const SYNC_HOLD_CHANCE = 0.4;
/** Continuous hold time an instruction demands. */
export const HOLD_MS_OPTIONS = [2000, 2500, 3000] as const;
export const SYNC_HOLD_MS_OPTIONS = [3000, 4000] as const;

export const MIN_PANEL_CONTROLS = 4;
export const MAX_PANEL_CONTROLS = 6;
/** Greedy fill stops here (once ≥ MIN_PANEL_CONTROLS) — see generatePanels. */
export const TARGET_PANEL_COMPLEXITY = 15;

// --- Difficulty / ship (Stage 5) ---------------------------------------

export const MAX_HEALTH = 100;
export const LEVEL_INTERVAL_MS = 20_000;

export interface Difficulty {
  /** Time a fresh instruction is given, ms. */
  deadlineMs: number;
  /** How many instructions each player holds at once. */
  instructionsPerPlayer: number;
  /** Health lost when an instruction expires. */
  expirePenalty: number;
  /** Health regained when an instruction completes (capped at MAX_HEALTH). */
  completeHeal: number;
}

/** Level 1 at the start, +1 every LEVEL_INTERVAL_MS of play. */
export function levelForElapsed(elapsedMs: number): number {
  return 1 + Math.max(0, Math.floor(elapsedMs / LEVEL_INTERVAL_MS));
}

export function difficultyFor(level: number): Difficulty {
  return {
    deadlineMs: Math.max(6_000, 22_000 - (level - 1) * 2_000),
    instructionsPerPlayer: level >= 6 ? 3 : level >= 3 ? 2 : 1,
    expirePenalty: 6 + level,
    completeHeal: 4,
  };
}

export type GamePhase = "playing" | "gameover";
export type GameOverReason = "health" | "crew";

export interface ShipView {
  health: number;
  maxHealth: number;
  /** Instructions completed by the whole crew. */
  progress: number;
  level: number;
  elapsedMs: number;
  phase: GamePhase;
  overReason?: GameOverReason;
}

// --- Instructions ---------------------------------------------------------

export type ExpectedOutcome =
  | { kind: "press"; fromCount: number }
  | { kind: "toggle"; on: boolean }
  | { kind: "direction"; value: Direction }
  | { kind: "select"; value: string | number }
  | { kind: "slider"; task: SliderTask }
  | { kind: "dial"; position: number }
  /** Hold the target control continuously for `forMs`. */
  | { kind: "hold"; forMs: number }
  /**
   * Hold the target control AND `withControlId` at the same time for `forMs`.
   * Releasing either one resets the progress to 0.
   */
  | {
      kind: "syncHold";
      forMs: number;
      withControlId: string;
      withControlLabel: string;
    };

export interface Instruction {
  id: string;
  controlId: string;
  /** Denormalized so text/UI never needs a lookup. Appears verbatim in `text`. */
  controlLabel: string;
  shownToPlayerId: string;
  expected: ExpectedOutcome;
  text: string;
  status: "active" | "completed" | "expired";
  /** Absolute server timestamp (ms) after which the instruction expires. */
  deadlineAt: number;
  /** The full deadline window in ms — for drawing the countdown bar. */
  totalMs: number;
}

export interface GameLike {
  controls: ControlInstance[];
  instructions: Instruction[];
}

/** One instruction as sent to the client — no absolute server timestamp. */
export interface InstructionView {
  id: string;
  controlId: string;
  controlLabel: string;
  text: string;
  remainingMs: number;
  totalMs: number;
  /** Present for hold / syncHold instructions: continuous-hold progress. */
  hold?: { heldMs: number; forMs: number };
}

/** What a single player is sent — only their own panel, instructions, ship. */
export interface PlayerView {
  room: RoomView;
  you: string;
  panel: ControlInstance[];
  instructions: InstructionView[];
  ship: ShipView;
  /** Present only once the game has ended — the crash scoreboard (Stage 7). */
  scoreboard?: ScoreboardView;
}

// --- Intents -------------------------------------------------------------

export type Intent =
  | { type: "press"; controlId: string }
  | { type: "set"; controlId: string; value: string | number | boolean }
  | { type: "hold-start"; controlId: string }
  | { type: "hold-end"; controlId: string };

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
    case "hold":
      return { kind: "hold", durationMs: 2500 };
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

  // A ≥ 2-player game must be able to present a synchronized hold, so guarantee
  // at least two hold controls on ≥ 2 different owners (so a sync hold needs two
  // players). Convert whichever non-hold control disturbs panel complexity least.
  if (playerIds.length >= 2) {
    const holdOwners = new Set(
      controls
        .filter((c) => c.definition.kind === "hold")
        .map((c) => c.ownerPlayerId),
    );
    const holdPool = rng
      .shuffle(namesForType("hold"))
      .filter((n) => !used.has(n.id));
    const holdWeight = CONTROL_COMPLEXITY.hold;

    while (holdOwners.size < 2 && holdPool.length) {
      const fresh = controls.filter(
        (c) => c.definition.kind !== "hold" && !holdOwners.has(c.ownerPlayerId),
      );
      if (!fresh.length) break;
      // Shuffle before the (stable) sort so ties on complexity-distance break
      // randomly rather than always favoring whoever joined first — Array.sort
      // is stable, and `fresh` is built from `controls` in join order, so an
      // unshuffled sort systematically handed the hold control to the first
      // one or two players almost every game (see DECISIONS.md).
      const pick = rng.shuffle(fresh).sort(
        (a, b) =>
          Math.abs(CONTROL_COMPLEXITY[a.definition.kind] - holdWeight) -
          Math.abs(CONTROL_COMPLEXITY[b.definition.kind] - holdWeight),
      )[0]!;
      const name = holdPool.pop()!;
      used.add(name.id);
      controls[controls.indexOf(pick)] = instantiateControl(
        pick.id,
        name.id,
        { kind: "hold", durationMs: 3000 },
        pick.ownerPlayerId,
      );
      holdOwners.add(pick.ownerPlayerId);
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
    case "hold":
      return { kind: "hold", forMs: rng.pick([...HOLD_MS_OPTIONS]) };
    default:
      throw new Error(`No expectation for control type ${def.kind}`);
  }
}

const secs = (ms: number) => `${Math.round(ms / 1000)}с`;

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
    case "hold":
      return `${label} → УДЕРЖАТЬ ${secs(expected.forMs)}`;
    case "syncHold":
      return `${label} + ${expected.withControlLabel} → УДЕРЖАТЬ ВМЕСТЕ ${secs(expected.forMs)}`;
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
export interface NextInstructionOpts {
  /** Absolute timestamp the instruction should expire at. */
  deadlineAt: number;
  /** The deadline window in ms (for the countdown bar). */
  totalMs: number;
  /** Don't re-target this control (e.g. the one just completed/expired). */
  avoidControlId?: string;
}

export function nextInstruction(
  recipientId: string,
  playerIds: readonly string[],
  controls: readonly ControlInstance[],
  activeInstructions: readonly Instruction[],
  rng: Rng,
  opts: NextInstructionOpts,
): Instruction {
  const { deadlineAt, totalMs, avoidControlId } = opts;
  const blocked = new Set<string>();
  for (const i of activeInstructions) {
    blocked.add(i.controlId);
    if (i.expected.kind === "syncHold") blocked.add(i.expected.withControlId);
  }
  if (avoidControlId) blocked.add(avoidControlId);

  // Synchronized hold: name two free hold controls (owned by anyone).
  const freeHolds = controls.filter(
    (c) => c.definition.kind === "hold" && !blocked.has(c.id),
  );
  if (freeHolds.length >= 2 && rng.next() < SYNC_HOLD_CHANCE) {
    const [a, b] = rng.shuffle(freeHolds);
    const expected: ExpectedOutcome = {
      kind: "syncHold",
      forMs: rng.pick([...SYNC_HOLD_MS_OPTIONS]),
      withControlId: b!.id,
      withControlLabel: b!.label,
    };
    return {
      id: newId(),
      controlId: a!.id,
      controlLabel: a!.label,
      shownToPlayerId: recipientId,
      expected,
      text: instructionText(a!.label, expected),
      status: "active",
      deadlineAt,
      totalMs,
    };
  }

  const ownerOf = (id: string) =>
    controls.find((c) => c.id === id)?.ownerPlayerId;
  const load = new Map<string, number>();
  const bump = (id: string | undefined) => {
    const o = id ? ownerOf(id) : undefined;
    if (o) load.set(o, (load.get(o) ?? 0) + 1);
  };
  for (const ins of activeInstructions) {
    bump(ins.controlId);
    if (ins.expected.kind === "syncHold") bump(ins.expected.withControlId);
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
    deadlineAt,
    totalMs,
  };
}

/** One active instruction per player, all with the same deadline window. */
export function generateInstructions(
  playerIds: readonly string[],
  controls: readonly ControlInstance[],
  rng: Rng,
  opts: { now: number; deadlineMs: number },
): Instruction[] {
  const out: Instruction[] = [];
  for (const pid of playerIds) {
    out.push(
      nextInstruction(pid, playerIds, controls, out, rng, {
        deadlineAt: opts.now + opts.deadlineMs,
        totalMs: opts.deadlineMs,
      }),
    );
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
  if (
    (intent.type === "hold-start" || intent.type === "hold-end") &&
    def.kind === "hold"
  ) {
    return { kind: "hold", held: intent.type === "hold-start" };
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
    case "hold":
    case "syncHold":
      // Completion is time-based (held long enough) — decided by the server
      // loop, not from a single control-state snapshot.
      return false;
  }
}

/** Continuous-hold progress for a hold / syncHold instruction, in ms. */
export function holdProgressMs(
  i: Instruction,
  heldSince: ReadonlyMap<string, number>,
  now: number,
): number {
  if (i.expected.kind === "hold") {
    const s = heldSince.get(i.controlId);
    return s === undefined ? 0 : now - s;
  }
  if (i.expected.kind === "syncHold") {
    const a = heldSince.get(i.controlId);
    const b = heldSince.get(i.expected.withControlId);
    if (a === undefined || b === undefined) return 0;
    return now - Math.max(a, b);
  }
  return 0;
}

export function holdComplete(
  i: Instruction,
  heldSince: ReadonlyMap<string, number>,
  now: number,
): boolean {
  if (i.expected.kind !== "hold" && i.expected.kind !== "syncHold") return false;
  return holdProgressMs(i, heldSince, now) >= i.expected.forMs;
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
  opts: {
    ship: ShipView;
    now: number;
    /** controlId -> ms the control has been held continuously (server state). */
    heldSince?: ReadonlyMap<string, number>;
  },
): PlayerView {
  const heldSince = opts.heldSince ?? new Map<string, number>();
  return {
    room,
    you: playerId,
    ship: opts.ship,
    panel: game.controls
      .filter((c) => c.ownerPlayerId === playerId)
      .map((c) =>
        c.definition.kind === "hold"
          ? { ...c, state: { kind: "hold" as const, held: heldSince.has(c.id) } }
          : c,
      ),
    instructions: game.instructions
      .filter((i) => i.shownToPlayerId === playerId && i.status === "active")
      .map((i) => {
        const isHold =
          i.expected.kind === "hold" || i.expected.kind === "syncHold";
        return {
          id: i.id,
          controlId: i.controlId,
          controlLabel: i.controlLabel,
          text: i.text,
          remainingMs: Math.max(0, i.deadlineAt - opts.now),
          totalMs: i.totalMs,
          ...(isHold
            ? {
                hold: {
                  heldMs: holdProgressMs(i, heldSince, opts.now),
                  forMs: (
                    i.expected as { forMs: number }
                  ).forMs,
                },
              }
            : {}),
        };
      }),
  };
}
