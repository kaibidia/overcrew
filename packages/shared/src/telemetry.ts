/**
 * Game telemetry & crash-scoreboard data model.
 *
 * The engine (`apps/server/src/game.ts`) emits these events at its own state
 * transitions — this module only defines their shape and a pure reducer that
 * turns the event log into a `ScoreboardView`. There is deliberately no
 * separate scoring logic: the scoreboard is a projection of the same events
 * used for debugging, so it can never diverge from what the engine actually
 * did (docs/Overcrew — Game Telemetry & Crash Scoreboard.md).
 *
 * Role vocabulary, mapped onto Overcrew's existing invariant (an instruction's
 * recipient and its control's owner are independent, see game.ts):
 *
 *   "source player" — Instruction.shownToPlayerId. The player who *reads* the
 *                      instruction and is responsible for shouting it out.
 *   "target player" — the owner of Instruction.controlId. The player who must
 *                      physically operate the control.
 *
 * These are tracked separately throughout so communication contribution
 * (source role) is never conflated with execution contribution (target role).
 *
 * Known, documented limitations (see docs/DECISIONS.md for the dated entry):
 *  - Overcrew has no speech recognition — "transmission" means the server
 *    successfully delivering the instruction to the source player's *own*
 *    connected socket at least once, not verbal recognition.
 *  - Overcrew is an endless survival game: there is no "completed / won" end
 *    reason. Only the two `GameOverReason`s the engine actually has
 *    ("health", "crew") are used as `EndReason` here.
 *  - `validateIntent` has no "executed incorrectly" terminal state — an
 *    action that doesn't satisfy the active instruction is a valid no-op, not
 *    a failure. The only failure this engine recognizes is a missed deadline
 *    ("expired"). `InstructionResolution` reflects only the statuses the
 *    engine actually produces.
 */
import type { ControlType } from "./model";
import type { ExpectedOutcome } from "./game";

export type EndReason = "health" | "crew";

export type InstructionResolution = "executed" | "expired" | "cancelled";

interface TelemetryBase {
  gameId: string;
  /** Server timestamp (ms) — same clock as `Instruction.deadlineAt`. */
  at: number;
}

export interface SessionStartedEvent extends TelemetryBase {
  type: "session_started";
  seed: string;
  playerIds: string[];
  difficulty: {
    deadlineMs: number;
    instructionsPerPlayer: number;
    expirePenalty: number;
    completeHeal: number;
  };
}

export interface SessionEndedEvent extends TelemetryBase {
  type: "session_ended";
  endReason: EndReason;
  elapsedMs: number;
  finalLevel: number;
  progress: number;
}

export interface ControlAssignedEvent extends TelemetryBase {
  type: "control_assigned";
  playerId: string;
  controlId: string;
  controlType: ControlType;
  controlLabel: string;
}

export interface InstructionCreatedEvent extends TelemetryBase {
  type: "instruction_created";
  instructionId: string;
  sequence: number;
  sourcePlayerId: string;
  /** Absent only if the control has no owner (shouldn't happen in a real game). */
  targetPlayerId?: string;
  targetControlId: string;
  targetControlLabel: string;
  instructionType: ExpectedOutcome["kind"];
  text: string;
  deadlineAt: number;
}

export interface InstructionTransmittedEvent extends TelemetryBase {
  type: "instruction_transmitted";
  instructionId: string;
  success: boolean;
  failureReason?: "recipient_never_connected";
}

export interface InstructionExecutionStartedEvent extends TelemetryBase {
  type: "instruction_execution_started";
  instructionId: string;
}

/**
 * Every raw intent a player actually sent, whether or not it satisfied an
 * instruction — the full "who did what to which control" log, independent of
 * the instruction lifecycle above.
 */
export interface CommandAppliedEvent extends TelemetryBase {
  type: "command_applied";
  playerId: string;
  controlId: string;
  intent: "press" | "set" | "hold-start" | "hold-end";
  /** Present only for `"set"` — the value the player sent. */
  value?: string | number | boolean;
  /** False if the control was unknown or not owned by this player. */
  accepted: boolean;
  completedInstructionId?: string;
}

export interface InstructionResolvedEvent extends TelemetryBase {
  type: "instruction_resolved";
  instructionId: string;
  status: InstructionResolution;
  /**
   * ms from first successful transmission (or execution start, for
   * hold/syncHold) to resolution. Absent for `cancelled` — a dropped
   * instruction was never meaningfully timed.
   */
  durationMs?: number;
}

export interface LifeChangedEvent extends TelemetryBase {
  type: "life_changed";
  before: number;
  after: number;
  cost: number;
  reason: "instruction_expired";
  instructionId: string;
  responsiblePlayerId?: string;
  sourcePlayerId: string;
  targetControlId: string;
}

export interface CrashEvent extends TelemetryBase {
  type: "crash";
  reason: EndReason;
  causedByInstructionId?: string;
  responsiblePlayerId?: string;
  sourcePlayerId?: string;
  targetControlId?: string;
  healthAtCrash: number;
}

export type TelemetryEvent =
  | SessionStartedEvent
  | SessionEndedEvent
  | ControlAssignedEvent
  | InstructionCreatedEvent
  | InstructionTransmittedEvent
  | InstructionExecutionStartedEvent
  | InstructionResolvedEvent
  | LifeChangedEvent
  | CrashEvent
  | CommandAppliedEvent;

// --- Scoreboard (pure projection of the event log) -------------------------

export interface PlayerScoreLine {
  playerId: string;
  /** Instructions where this player was the source (recipient) and delivery succeeded. */
  transmitted: number;
  /** Instructions where this player was the target (control owner) and completed it. */
  executed: number;
  /** Instructions where this player was the target and it expired. */
  failed: number;
  /** Average ms to complete, over this player's own `executed` instructions. `null` if none. */
  avgExecutionMs: number | null;
  causedCrash: boolean;
}

export interface CrashInfo {
  reason: EndReason;
  instructionId?: string;
  responsiblePlayerId?: string;
  sourcePlayerId?: string;
  targetControlId?: string;
  targetControlLabel?: string;
  instructionText?: string;
  healthAtCrash: number;
}

export interface ScoreboardView {
  players: PlayerScoreLine[];
  crash?: CrashInfo;
}

/**
 * Build the crash scoreboard purely from the telemetry log — no independent
 * counters. Safe to call at any point; player order follows `session_started`.
 */
export function buildScoreboard(events: readonly TelemetryEvent[]): ScoreboardView {
  const started = events.find(
    (e): e is SessionStartedEvent => e.type === "session_started",
  );
  const playerIds = started?.playerIds ?? [];

  const created = new Map<string, InstructionCreatedEvent>();
  for (const e of events) {
    if (e.type === "instruction_created") created.set(e.instructionId, e);
  }

  const lines = new Map<string, PlayerScoreLine>();
  const line = (playerId: string): PlayerScoreLine => {
    let l = lines.get(playerId);
    if (!l) {
      l = {
        playerId,
        transmitted: 0,
        executed: 0,
        failed: 0,
        avgExecutionMs: null,
        causedCrash: false,
      };
      lines.set(playerId, l);
    }
    return l;
  };
  for (const pid of playerIds) line(pid);

  const execDurations = new Map<string, number[]>();

  for (const e of events) {
    if (e.type === "instruction_transmitted") {
      if (!e.success) continue;
      const c = created.get(e.instructionId);
      if (!c) continue;
      line(c.sourcePlayerId).transmitted += 1;
    } else if (e.type === "instruction_resolved") {
      const c = created.get(e.instructionId);
      if (!c || !c.targetPlayerId) continue;
      if (e.status === "executed") {
        line(c.targetPlayerId).executed += 1;
        if (e.durationMs !== undefined) {
          const arr = execDurations.get(c.targetPlayerId) ?? [];
          arr.push(e.durationMs);
          execDurations.set(c.targetPlayerId, arr);
        }
      } else if (e.status === "expired") {
        line(c.targetPlayerId).failed += 1;
      }
      // "cancelled" intentionally counts toward nothing — a player leaving
      // (or one of their controls going away) must not read as a failure.
    }
  }

  for (const [pid, durations] of execDurations) {
    if (durations.length === 0) continue;
    const sum = durations.reduce((a, b) => a + b, 0);
    line(pid).avgExecutionMs = sum / durations.length;
  }

  let crash: CrashInfo | undefined;
  const crashEvent = [...events].reverse().find((e): e is CrashEvent => e.type === "crash");
  if (crashEvent) {
    const c = crashEvent.causedByInstructionId
      ? created.get(crashEvent.causedByInstructionId)
      : undefined;
    crash = {
      reason: crashEvent.reason,
      instructionId: crashEvent.causedByInstructionId,
      responsiblePlayerId: crashEvent.responsiblePlayerId,
      sourcePlayerId: crashEvent.sourcePlayerId,
      targetControlId: crashEvent.targetControlId,
      targetControlLabel: c?.targetControlLabel,
      instructionText: c?.text,
      healthAtCrash: crashEvent.healthAtCrash,
    };
    if (crashEvent.responsiblePlayerId) {
      line(crashEvent.responsiblePlayerId).causedCrash = true;
    }
  }

  return { players: [...lines.values()], crash };
}
