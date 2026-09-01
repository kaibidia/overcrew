import {
  MAX_HEALTH,
  buildPlayerView,
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
  type ShipView,
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

  constructor(playerIds: string[], opts: { seed?: string; now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.seed =
      opts.seed ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const gen = createRng(this.seed);
    this.playerIds = [...playerIds];
    this.controls = generatePanels(this.playerIds, gen);
    this.live = createRng(`${this.seed}:live`);
    this.startedAt = this.now();
    this.refill();
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
    return buildPlayerView(room, playerId, this, {
      ship: this.ship(),
      now: this.now(),
      heldSince: this.held,
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
    for (const e of expired) {
      e.status = "expired";
      this.held.delete(e.controlId);
      if (e.expected.kind === "syncHold") this.held.delete(e.expected.withControlId);
      this.health -= diff.expirePenalty;
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

    if (this.health <= 0) this.endGame("health");
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
    this.scheduleHoldCheck();
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

  private endGame(reason: GameOverReason): void {
    if (this.over) return;
    this.over = true;
    this.overReason = reason;
    this.health = Math.max(0, this.health);
    this.stop();
  }
}
