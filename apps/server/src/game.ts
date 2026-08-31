import {
  MAX_HEALTH,
  buildPlayerView,
  createRng,
  difficultyFor,
  generatePanels,
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

/**
 * Authoritative in-game state for one room (Stage 5).
 *
 * Owns the 1 Hz loop: expires overdue instructions (draining health), tops each
 * player's instruction count up to the current difficulty, ramps difficulty with
 * elapsed time, and ends the game at 0 health or when the crew drops below two.
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

  private readonly live: Rng;
  private timer: ReturnType<typeof setInterval> | undefined;
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

  /** Start the 1 Hz loop. `onChange` is called every tick. */
  start(onChange: () => void): void {
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

    this.refill();

    if (this.health <= 0) this.endGame("health");
  }

  // --- intents -------------------------------------------------------

  applyIntent(
    playerId: string,
    intent: Intent,
  ): { changed: boolean; completed: boolean } {
    if (this.over) return { changed: false, completed: false };

    const res = validateIntent(this, playerId, intent);
    if (!res.ok || !res.nextState) return { changed: false, completed: false };

    const control = this.controls.find((c) => c.id === intent.controlId)!;
    const before = JSON.stringify(control.state);
    control.state = res.nextState;
    const changed = JSON.stringify(control.state) !== before;

    if (!res.completedInstructionId) return { changed, completed: false };

    const done = this.instructions.find(
      (i) => i.id === res.completedInstructionId,
    )!;
    this.instructions = this.instructions.filter((i) => i.id !== done.id);
    this.progress += 1;
    this.health = Math.min(
      MAX_HEALTH,
      this.health + difficultyFor(this.level()).completeHeal,
    );
    this.addInstruction(done.shownToPlayerId, done.controlId);
    return { changed: true, completed: true };
  }

  // --- crew changes -------------------------------------------------

  /** A player left / was dropped mid-game. */
  removePlayer(playerId: string): void {
    if (this.over) return;
    this.playerIds = this.playerIds.filter((p) => p !== playerId);
    // Their controls are gone; retire any instruction that referenced them.
    const goneControlIds = new Set(
      this.controls
        .filter((c) => c.ownerPlayerId === playerId)
        .map((c) => c.id),
    );
    for (let i = this.controls.length - 1; i >= 0; i--) {
      if (this.controls[i]!.ownerPlayerId === playerId) this.controls.splice(i, 1);
    }
    const orphaned = this.instructions.filter(
      (i) => i.shownToPlayerId === playerId || goneControlIds.has(i.controlId),
    );
    this.instructions = this.instructions.filter((i) => !orphaned.includes(i));
    for (const o of orphaned) {
      if (o.shownToPlayerId !== playerId && this.playerIds.includes(o.shownToPlayerId)) {
        this.addInstruction(o.shownToPlayerId, o.controlId);
      }
    }

    if (this.playerIds.length < 2) this.endGame("crew");
  }

  // --- internals ---------------------------------------------------

  /** Top every remaining player up to the current difficulty's instruction count. */
  private refill(): void {
    if (this.over) return;
    const diff = difficultyFor(this.level());
    for (const pid of this.playerIds) {
      let held = this.instructions.filter(
        (i) => i.status === "active" && i.shownToPlayerId === pid,
      ).length;
      while (held < diff.instructionsPerPlayer) {
        this.addInstruction(pid);
        held += 1;
      }
    }
  }

  private addInstruction(recipientId: string, avoidControlId?: string): void {
    if (this.controls.length === 0) return;
    const diff = difficultyFor(this.level());
    const now = this.now();
    this.instructions.push(
      nextInstruction(
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
      ),
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
