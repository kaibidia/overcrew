import {
  buildPlayerView,
  createRng,
  generateInstructions,
  generatePanels,
  nextInstruction,
  validateIntent,
  type ControlInstance,
  type Instruction,
  type Intent,
  type PlayerView,
  type Rng,
  type RoomView,
} from "@overcrew/shared";

/** Authoritative in-game state for one room. Stage 3: no timers, no health. */
export class Game {
  readonly controls: ControlInstance[];
  instructions: Instruction[];
  readonly seed: string;
  private readonly live: Rng;

  constructor(
    readonly playerIds: string[],
    seed?: string,
  ) {
    this.seed =
      seed ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const gen = createRng(this.seed);
    this.controls = generatePanels(playerIds, gen);
    this.instructions = generateInstructions(playerIds, this.controls, gen);
    this.live = createRng(`${this.seed}:live`);
  }

  viewFor(room: RoomView, playerId: string): PlayerView {
    return buildPlayerView(room, playerId, this);
  }

  /**
   * Apply a player's intent. Returns whether anything changed (so the caller
   * knows to re-broadcast) and whether an instruction completed.
   */
  applyIntent(
    playerId: string,
    intent: Intent,
  ): { changed: boolean; completed: boolean } {
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
    this.instructions.push(
      nextInstruction(
        done.shownToPlayerId,
        this.playerIds,
        this.controls,
        this.instructions,
        this.live,
      ),
    );
    return { changed: true, completed: true };
  }
}
