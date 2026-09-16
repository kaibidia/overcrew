import { randomUUID } from "node:crypto";
import {
  MAX_HEALTH,
  buildPlayerView,
  buildScoreboard,
  createRng,
  difficultyFor,
  generatePanels,
  holdComplete,
  holdProgressMs,
  levelForElapsed,
  nextInstruction,
  validateIntent,
  type ControlInstance,
  type GameOverReason,
  type Instruction,
  type Intent,
  type PlayerView,
  type Rng,
  type RoomView,
  type ScoreboardView,
  type ShipView,
  type TelemetryEvent,
} from "@overcrew/shared";

type Timer = ReturnType<typeof setTimeout>;

/**
 * Authoritative in-game state for one room (Stage 5–6).
 *
 * Owns the 1 Hz loop (deadlines / difficulty ramp / game over) and hold state:
 * `held` maps a control id to the timestamp it was pressed. Hold and
 * synchronized-hold instructions complete purely from elapsed held time, checked
 * on every hold intent, on a scheduled one-shot, and each tick.
 */
export class Game {
  readonly controls: ControlInstance[];
  instructions: Instruction[] = [];
  readonly seed: string;
  readonly startedAt: number;
  /** Stable id for this play session — see docs/Overcrew — Game Telemetry & Crash Scoreboard.md. */
  readonly gameId: string;

  playerIds: string[];
  private health = MAX_HEALTH;
  private progress = 0;
  private over = false;
  private overReason: GameOverReason | undefined;

  /** controlId -> ms the control has been held continuously. */
  private readonly held = new Map<string, number>();
  private holdCheckTimer: Timer | undefined;

  private readonly live: Rng;
  private timer: ReturnType<typeof setInterval> | undefined;
  private onChange: (() => void) | undefined;
  private readonly now: () => number;

  // --- telemetry (Stage 7) ---------------------------------------------
  private readonly telemetry: TelemetryEvent[] = [];
  private instructionSeq = 0;
  /** Instruction ids the source player's client has actually received at least once. */
  private readonly seen = new Set<string>();
  /** Instruction ids whose (hold) execution start has already been recorded. */
  private readonly executionStarted = new Set<string>();
  /** instructionId -> timestamps used to compute transmission/execution durations. */
  private readonly timing = new Map<
    string,
    { createdAt: number; firstSeenAt?: number; executionStartAt?: number }
  >();
  /** Computed once, at game over — the scoreboard is a projection of `telemetry`. */
  private scoreboard: ScoreboardView | undefined;

  constructor(playerIds: string[], opts: { seed?: string; now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.seed =
      opts.seed ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.gameId = randomUUID();
    const gen = createRng(this.seed);
    this.playerIds = [...playerIds];
    this.controls = generatePanels(this.playerIds, gen);
    this.live = createRng(`${this.seed}:live`);
    this.startedAt = this.now();

    const diff = difficultyFor(1);
    this.telemetry.push({
      type: "session_started",
      gameId: this.gameId,
      at: this.startedAt,
      seed: this.seed,
      playerIds: [...this.playerIds],
      difficulty: diff,
    });
    for (const c of this.controls) {
      if (!c.ownerPlayerId) continue;
      this.telemetry.push({
        type: "control_assigned",
        gameId: this.gameId,
        at: this.startedAt,
        playerId: c.ownerPlayerId,
        controlId: c.id,
        controlType: c.definition.kind,
        controlLabel: c.label,
      });
    }

    this.refill();
  }

  /** Read-only telemetry log, for debugging / future export (Stage 7). */
  getTelemetry(): readonly TelemetryEvent[] {
    return this.telemetry;
  }

  /** The crash scoreboard, once the game has ended — `undefined` while still playing. */
  getScoreboard(): ScoreboardView | undefined {
    return this.scoreboard;
  }

  get isOver(): boolean {
    return this.over;
  }

  /** Start the 1 Hz loop. `onChange` is called every tick and on hold events. */
  start(onChange: () => void): void {
    this.onChange = onChange;
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.step();
      onChange();
    }, 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.holdCheckTimer) {
      clearTimeout(this.holdCheckTimer);
      this.holdCheckTimer = undefined;
    }
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  private level(): number {
    return levelForElapsed(this.elapsedMs());
  }

  ship(): ShipView {
    return {
      health: Math.max(0, Math.round(this.health)),
      maxHealth: MAX_HEALTH,
      progress: this.progress,
      level: this.level(),
      elapsedMs: this.elapsedMs(),
      phase: this.over ? "gameover" : "playing",
      ...(this.overReason ? { overReason: this.overReason } : {}),
    };
  }

  viewFor(room: RoomView, playerId: string): PlayerView {
    const view = buildPlayerView(room, playerId, this, {
      ship: this.ship(),
      now: this.now(),
      heldSince: this.held,
    });
    return this.scoreboard ? { ...view, scoreboard: this.scoreboard } : view;
  }

  /**
   * Called by the transport layer (`apps/server/src/index.ts`) once a live
   * `PlayerView` containing this instruction actually reaches the source
   * player's connected socket. Idempotent — only the first delivery matters
   * for "successfully transmitted". Overcrew has no speech recognition, so
   * this is the only "transmission" the engine can observe.
   */
  markSeen(instructionId: string): void {
    if (this.seen.has(instructionId)) return;
    const ins = this.instructions.find((i) => i.id === instructionId);
    if (!ins) return;
    this.seen.add(instructionId);
    const now = this.now();
    const timing = this.timing.get(instructionId);
    if (timing) timing.firstSeenAt = now;
    this.telemetry.push({
      type: "instruction_transmitted",
      gameId: this.gameId,
      at: now,
      instructionId,
      success: true,
    });
  }

  // --- the loop -------------------------------------------------------

  /** One iteration of the 1 Hz loop. Public so tests can drive it with a clock. */
  step(): void {
    if (this.over) return;
    const now = this.now();
    const diff = difficultyFor(this.level());

    const expired = this.instructions.filter(
      (i) => i.status === "active" && i.deadlineAt <= now,
    );
    let crashCause: CrashCause | undefined;
    for (const e of expired) {
      e.status = "expired";
      this.held.delete(e.controlId);
      if (e.expected.kind === "syncHold") this.held.delete(e.expected.withControlId);

      const before = this.health;
      this.health -= diff.expirePenalty;
      const after = this.health;
      const responsiblePlayerId = this.controls.find(
        (c) => c.id === e.controlId,
      )?.ownerPlayerId;

      this.telemetry.push({
        type: "life_changed",
        gameId: this.gameId,
        at: now,
        before,
        after,
        cost: diff.expirePenalty,
        reason: "instruction_expired",
        instructionId: e.id,
        responsiblePlayerId,
        sourcePlayerId: e.shownToPlayerId,
        targetControlId: e.controlId,
      });
      this.resolveInstruction(e, "expired");

      // The FIRST expiry that actually tips health to zero is the crash
      // cause — later expiries in the same tick just pile on afterwards.
      if (!crashCause && after <= 0) {
        crashCause = {
          instructionId: e.id,
          responsiblePlayerId,
          sourcePlayerId: e.shownToPlayerId,
          targetControlId: e.controlId,
        };
      }
    }
    if (expired.length) {
      this.instructions = this.instructions.filter((i) => i.status === "active");
      for (const e of expired) {
        if (this.playerIds.includes(e.shownToPlayerId)) {
          this.addInstruction(e.shownToPlayerId, e.controlId);
        }
      }
    }

    this.checkHoldCompletions();
    this.refill();
    this.scheduleHoldCheck();

    if (this.health <= 0) this.endGame("health", crashCause);
  }

  // --- intents -------------------------------------------------------

  applyIntent(
    playerId: string,
    intent: Intent,
  ): { changed: boolean; completed: boolean } {
    if (this.over) return { changed: false, completed: false };

    if (intent.type === "hold-start" || intent.type === "hold-end") {
      const control = this.controls.find((c) => c.id === intent.controlId);
      if (
        !control ||
        control.ownerPlayerId !== playerId ||
        control.definition.kind !== "hold"
      ) {
        return { changed: false, completed: false };
      }
      const holding = intent.type === "hold-start";
      if (holding) {
        if (!this.held.has(intent.controlId)) {
          this.held.set(intent.controlId, this.now());
          const ins = this.instructions.find(
            (i) =>
              i.status === "active" &&
              (i.controlId === intent.controlId ||
                (i.expected.kind === "syncHold" &&
                  i.expected.withControlId === intent.controlId)),
          );
          if (ins) this.markExecutionStarted(ins.id);
        }
      } else {
        this.held.delete(intent.controlId);
      }
      control.state = { kind: "hold", held: holding };
      const completed = this.checkHoldCompletions();
      this.scheduleHoldCheck();
      return { changed: true, completed };
    }

    const res = validateIntent(this, playerId, intent);
    if (!res.ok || !res.nextState) return { changed: false, completed: false };

    const control = this.controls.find((c) => c.id === intent.controlId)!;
    const before = JSON.stringify(control.state);
    control.state = res.nextState;
    const changed = JSON.stringify(control.state) !== before;

    if (!res.completedInstructionId) return { changed, completed: false };
    this.completeInstruction(res.completedInstructionId);
    return { changed: true, completed: true };
  }

  // --- crew changes -------------------------------------------------

  /** A player's controls are all released (transient disconnect). */
  releaseHolds(playerId: string): void {
    let touched = false;
    for (const c of this.controls) {
      if (c.ownerPlayerId === playerId && this.held.delete(c.id)) {
        if (c.state.kind === "hold") c.state = { kind: "hold", held: false };
        touched = true;
      }
    }
    if (touched) this.scheduleHoldCheck();
  }

  /** A player left / was dropped mid-game. */
  removePlayer(playerId: string): void {
    if (this.over) return;
    this.playerIds = this.playerIds.filter((p) => p !== playerId);
    const goneControlIds = new Set(
      this.controls
        .filter((c) => c.ownerPlayerId === playerId)
        .map((c) => c.id),
    );
    for (const id of goneControlIds) this.held.delete(id);
    for (let i = this.controls.length - 1; i >= 0; i--) {
      if (this.controls[i]!.ownerPlayerId === playerId) this.controls.splice(i, 1);
    }
    const orphaned = this.instructions.filter(
      (i) =>
        i.shownToPlayerId === playerId ||
        goneControlIds.has(i.controlId) ||
        (i.expected.kind === "syncHold" &&
          goneControlIds.has(i.expected.withControlId)),
    );
    this.instructions = this.instructions.filter((i) => !orphaned.includes(i));
    for (const o of orphaned) {
      // The instruction never got a resolution of its own — it's cancelled,
      // not failed, so it must not count against anyone's failure stats.
      this.resolveInstruction(o, "cancelled");
      if (
        o.shownToPlayerId !== playerId &&
        this.playerIds.includes(o.shownToPlayerId)
      ) {
        this.addInstruction(o.shownToPlayerId, o.controlId);
      }
    }
    this.scheduleHoldCheck();

    if (this.playerIds.length < 2) this.endGame("crew");
  }

  // --- internals ---------------------------------------------------

  /** Complete any hold / syncHold instruction whose controls have been held long enough. */
  private checkHoldCompletions(): boolean {
    if (this.over) return false;
    const now = this.now();
    const done = this.instructions.filter(
      (i) => i.status === "active" && holdComplete(i, this.held, now),
    );
    for (const i of done) {
      this.held.delete(i.controlId);
      if (i.expected.kind === "syncHold") this.held.delete(i.expected.withControlId);
      this.completeInstruction(i.id);
    }
    return done.length > 0;
  }

  private completeInstruction(instructionId: string): void {
    const done = this.instructions.find((i) => i.id === instructionId);
    if (!done) return;
    this.instructions = this.instructions.filter((i) => i.id !== done.id);
    this.resolveInstruction(done, "executed");
    this.progress += 1;
    this.health = Math.min(
      MAX_HEALTH,
      this.health + difficultyFor(this.level()).completeHeal,
    );
    this.addInstruction(done.shownToPlayerId, done.controlId);
  }

  private refill(): void {
    if (this.over) return;
    const diff = difficultyFor(this.level());
    for (const pid of this.playerIds) {
      let count = this.instructions.filter(
        (i) => i.status === "active" && i.shownToPlayerId === pid,
      ).length;
      while (count < diff.instructionsPerPlayer) {
        this.addInstruction(pid);
        count += 1;
      }
    }
  }

  private addInstruction(recipientId: string, avoidControlId?: string): void {
    if (this.controls.length === 0) return;
    const diff = difficultyFor(this.level());
    const now = this.now();
    const ins = nextInstruction(
      recipientId,
      this.playerIds,
      this.controls,
      this.instructions,
      this.live,
      {
        deadlineAt: now + diff.deadlineMs,
        totalMs: diff.deadlineMs,
        ...(avoidControlId ? { avoidControlId } : {}),
      },
    );
    // Hold instructions get a more generous deadline — the coordination is the
    // challenge, not the clock.
    if (ins.expected.kind === "hold" || ins.expected.kind === "syncHold") {
      const extra = ins.expected.forMs + 5000;
      ins.deadlineAt += extra;
      ins.totalMs += extra;
    }
    this.instructions.push(ins);

    this.instructionSeq += 1;
    this.timing.set(ins.id, { createdAt: now });
    this.telemetry.push({
      type: "instruction_created",
      gameId: this.gameId,
      at: now,
      instructionId: ins.id,
      sequence: this.instructionSeq,
      sourcePlayerId: ins.shownToPlayerId,
      targetPlayerId: this.controls.find((c) => c.id === ins.controlId)
        ?.ownerPlayerId,
      targetControlId: ins.controlId,
      targetControlLabel: ins.controlLabel,
      instructionType: ins.expected.kind,
      text: ins.text,
      deadlineAt: ins.deadlineAt,
    });

    this.scheduleHoldCheck();
  }

  // --- telemetry internals ------------------------------------------

  /** First hold-start on a control that satisfies an active hold/syncHold instruction. */
  private markExecutionStarted(instructionId: string): void {
    if (this.executionStarted.has(instructionId)) return;
    this.executionStarted.add(instructionId);
    const now = this.now();
    const timing = this.timing.get(instructionId);
    if (timing) timing.executionStartAt = now;
    this.telemetry.push({
      type: "instruction_execution_started",
      gameId: this.gameId,
      at: now,
      instructionId,
    });
  }

  /**
   * Record the terminal outcome of one instruction. If it was never
   * successfully delivered to its source player (`markSeen` never fired),
   * that failed delivery is recorded first — an instruction can resolve
   * without ever having been transmitted (e.g. its recipient was
   * disconnected the whole time).
   */
  private resolveInstruction(
    ins: Instruction,
    status: "executed" | "expired" | "cancelled",
  ): void {
    const now = this.now();
    if (!this.seen.has(ins.id)) {
      this.telemetry.push({
        type: "instruction_transmitted",
        gameId: this.gameId,
        at: now,
        instructionId: ins.id,
        success: false,
        failureReason: "recipient_never_connected",
      });
    }
    const timing = this.timing.get(ins.id);
    let durationMs: number | undefined;
    if (status !== "cancelled" && timing) {
      const start = timing.executionStartAt ?? timing.firstSeenAt ?? timing.createdAt;
      durationMs = Math.max(0, now - start);
    }
    this.telemetry.push({
      type: "instruction_resolved",
      gameId: this.gameId,
      at: now,
      instructionId: ins.id,
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
    this.timing.delete(ins.id);
    this.seen.delete(ins.id);
    this.executionStarted.delete(ins.id);
  }

  /** One-shot: fire when the soonest hold-in-progress would complete. */
  private scheduleHoldCheck(): void {
    if (this.holdCheckTimer) {
      clearTimeout(this.holdCheckTimer);
      this.holdCheckTimer = undefined;
    }
    // Purely a "broadcast sooner" optimisation; without a running loop the tick
    // (or tests) drive completion. This also keeps real timers out of tests.
    if (this.over || !this.onChange) return;
    const now = this.now();
    let soonest = Infinity;
    for (const i of this.instructions) {
      if (i.status !== "active") continue;
      if (i.expected.kind !== "hold" && i.expected.kind !== "syncHold") continue;
      const progress = holdProgressMs(i, this.held, now);
      if (progress <= 0) continue;
      soonest = Math.min(soonest, i.expected.forMs - progress);
    }
    if (soonest === Infinity) return;
    this.holdCheckTimer = setTimeout(
      () => {
        this.holdCheckTimer = undefined;
        if (this.checkHoldCompletions()) this.onChange?.();
        if (this.health <= 0) {
          this.endGame("health");
          this.onChange?.();
        }
        this.scheduleHoldCheck();
      },
      Math.max(0, soonest) + 20,
    );
  }

  private endGame(reason: GameOverReason, cause?: CrashCause): void {
    if (this.over) return;
    this.over = true;
    this.overReason = reason;
    this.health = Math.max(0, this.health);
    this.stop();

    const now = this.now();
    this.telemetry.push({
      type: "session_ended",
      gameId: this.gameId,
      at: now,
      endReason: reason,
      elapsedMs: this.elapsedMs(),
      finalLevel: this.level(),
      progress: this.progress,
    });
    this.telemetry.push({
      type: "crash",
      gameId: this.gameId,
      at: now,
      reason,
      causedByInstructionId: cause?.instructionId,
      responsiblePlayerId: cause?.responsiblePlayerId,
      sourcePlayerId: cause?.sourcePlayerId,
      targetControlId: cause?.targetControlId,
      healthAtCrash: this.health,
    });
    // The scoreboard is a pure projection of `telemetry` — computed once here
    // so it doesn't have to be rebuilt on every broadcast after game over.
    this.scoreboard = buildScoreboard(this.telemetry);
  }
}

/** Only the instruction whose expiry actually tipped health to zero, if any. */
interface CrashCause {
  instructionId: string;
  responsiblePlayerId?: string;
  sourcePlayerId: string;
  targetControlId: string;
}
