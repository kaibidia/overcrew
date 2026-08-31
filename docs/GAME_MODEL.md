# GAME_MODEL.md — Overcrew

Status: the control model (types · names · instances · complexity) is
**implemented** in `packages/shared/src/{model,names,panel}.ts` (Stage 1). Room,
instruction and validation types below remain **proposed** (Stage 2+) — the code
shapes are the authority once each lands.

---

## Core invariant (do not violate)

> **Instruction recipient and control owner are independent.**
> `instruction.shownToPlayerId` and `controlInstance.ownerPlayerId`
> MAY be equal and MAY be different. Never encode a rule forcing either.

Every actionable instruction contains its target control's **name** verbatim, so a player
can shout it and another player can find the control.

---

## Four separate concepts: type · name · instance · complexity

There is **no assumption that one interaction type maps to one name**. A 4-player
match holds ~24 control instances (4–6 per player); many share a type, as long as
their visible names are unique. See `DECISIONS.md` D21–D25.

### 1. ControlType — *what interaction exists*

Mechanic only. No name, no owner, no position. Exactly these eight for V1 — no
compound controls yet.

```ts
type ControlType =
  | "button"        // single tap
  | "toggle"        // ВКЛ / ВЫКЛ
  | "direction"     // ВВЕРХ / ВНИЗ / ВЛЕВО / ВПРАВО
  | "shapeSelector" // discrete set shown at once, e.g. shapes ● ▲ ■ ◆
  | "slider"        // discrete steps over a range (0–100, stepped)
  | "dial"          // directly-dragged rotary with discrete positions
  | "hold"          // press and keep holding (local only until Stage 6)
  | "mash";         // N repeated taps        (local only until Stage 7)

// ControlDefinition is a discriminated union on `kind` (= the ControlType),
// carrying only that type's params:
type ControlDefinition =
  | { kind: "button" }
  | { kind: "toggle" }
  | { kind: "direction" }
  | { kind: "shapeSelector"; values: ReadonlyArray<string | number> }
  | { kind: "slider"; min: number; max: number; step: number }
  | { kind: "dial"; positions: number }          // stored 0-indexed, shown 1..N
  | { kind: "hold"; durationMs: number }
  | { kind: "mash"; targetTaps: number };
```

### 2. ControlName — *the curated label + which types it may take*

```ts
interface ControlNameDef {
  id: string;                          // referenced by ControlInstance.nameId
  label: string;                       // "ТУРБОЖАБА" — what players shout
  compatibleTypes: readonly ControlType[];   // ≥ 1; hand-curated, no nonsense
}
```

Names live in `names.ts`, approved manually in small batches so the spoken
vocabulary stays phonetically distinct. `compatibleTypes` keeps the model honest
without forcing unnatural pairings:

| name | compatibleTypes |
|---|---|
| `ПЛАЗМОНАСОС`, `АВАРИЙНЫЙ СБРОС`, `ИОННЫЙ ПУСКАТЕЛЬ`, `КВАНТОВЫЙ ЗВОНОК`, `ТУРБОСТАРТЕР` | `["button"]` |
| `КРИОКЛАПАН` | `["toggle"]` |
| `ГИРОСКОП` | `["direction"]` |
| `ТУРБОЖАБА` | `["shapeSelector"]` |
| `ДАВЛЕНИЕ` | `["slider", "dial"]` |
| `ФАЗОВРАЩАТЕЛЬ` | `["dial", "toggle"]` |
| `СТАБИЛИЗАТОР` | `["hold"]` |
| `ИМПУЛЬСАТОР` | `["mash"]` |

Only `button` has an approved multi-name pool so far; the rest keep one example
name pending separate approval.

### 3. ControlInstance — *a concrete generated control*

```ts
interface ControlInstance {
  id: string;
  nameId: string;             // → ControlNameDef.id
  label: string;              // denormalized; unique across the whole active game
  definition: ControlDefinition;   // .kind is the ControlType
  ownerPlayerId?: string;     // unset in the Stage 1 local playground
  state: ControlState;        // current value; `kind` matches the definition
}
```

`instantiateControl(id, nameId, definition)` resolves the label and **throws** if
`definition.kind ∉ name.compatibleTypes`.

`label` is unique across the **entire active game** (`hasUniqueLabels`), not just
one panel — an instruction naming `ТУРБОЖАБА` must be globally unambiguous.
Repeated interaction *types* are expected and never constrained. Different
matches may reuse names.

Layout (footprint, position, slider orientation) is **not** part of the model —
the client decides it from the panel contents (`docs/PANEL_LAYOUT.md`). The
server never models screen geometry. (Contrast: OpenSpaceTeam bakes grid
geometry into generation.)

### 4. ControlComplexity — *a 1–10 score on the TYPE*

See the table below. It belongs to the type, never a name. It is **not** task
difficulty (§ "Complexity is not task difficulty").

### 5. Instruction — *a desired action referencing a control*

**Implemented (`shared/game.ts`)**, all six control types:

```ts
interface Instruction {
  id: string;
  controlId: string;          // the ControlInstance it targets
  controlLabel: string;       // denormalized; appears verbatim in `text`
  shownToPlayerId: string;    // who sees it — independent of the control's owner
  expected: ExpectedOutcome;
  text: string;               // Russian, contains controlLabel verbatim
  status: "active" | "completed" | "expired";
  deadlineAt: number;         // server timestamp; on the wire it's remainingMs
  totalMs: number;            // deadline window, for the countdown bar
}

type ExpectedOutcome =
  | { kind: "press"; fromCount: number }   // met when pressCount > fromCount
  | { kind: "toggle"; on: boolean }
  | { kind: "direction"; value: Direction }
  | { kind: "select"; value: string | number }      // shapeSelector
  | { kind: "slider"; task: SliderTask }             // targetValue ± tolerance
  | { kind: "dial"; position: number };              // 0-indexed; shown +1
// later: hold(ms), taps(n); + deadlineAt (Stage 5)
```

Text: `ТУРБОЖАБА → ◆`, `НЕЙТРОННЫЙ КРАН → ВКЛ`, `ПЛАЗМОНАСОС → НАЖАТЬ`,
`ГИРОСКОП → ВЛЕВО`, `ДАВЛЕНИЕ → 67 ± 3`, `ФАЗОВРАЩАТЕЛЬ → 6`. Never produce
ownership-implying text ("твоя задача", "свой"). A slider instruction's tolerance
band is never drawn on the acting player's slider (D29).

**Intent + validation.** Client sends `Intent`
(`{ type:"press", controlId } | { type:"set", controlId, value }`) via
`game:intent`. The server calls the pure `validateIntent(game, playerId, intent)`
→ `{ ok, nextState?, completedInstructionId? }` (`ok:false` only for unknown
control / non-owner). It applies `nextState`, and on completion retires the
instruction and issues a replacement for the same recipient. A non-matching
action is a valid no-op.

**Targeting rules** (`nextInstruction`): target owner independent of recipient,
self only ~`SELF_TARGET_CHANCE` (0.2); prefer the owner with the fewest active
instructions; skip controls already targeted.

### Slider tasks — `targetValue ± tolerance`  *(first task primitive, `tasks.ts`)*

A slider instruction does **not** request one exact number by default:

```ts
interface SliderTask { targetValue: number; tolerance: number }   // "ДАВЛЕНИЕ → 67 ± 3"
```

- Accepted ⇔ `Math.abs(value - targetValue) <= tolerance`, both bounds inclusive.
- The accepted range is **clamped to the slider's physical [0, 100]**:
  `97 ± 5` → 92..100 (not 92..102).
- `tolerance: 0` → the exact value is required.
- `sliderTaskRange(task)` returns `{ lo, hi }`; `isSliderValueAccepted(value, task)`
  does the check.
- **UX rule:** the accepted band is never drawn on the slider. The player reaches
  the target from the spoken value + the numeric readout; a visible zone would
  remove the coordination challenge.

Tolerance is **task difficulty, not control complexity** — the slider stays
complexity 5 whatever the tolerance (`50 ± 10` easy, `83 ± 2` hard, `41 ± 0`
very precise).

---

## Player and room

**Implemented (Stage 2, `shared/room.ts` + `apps/server`):** `RoomPhase`,
`PublicPlayer`, `RoomView` (the fully-public lobby broadcast — code, phase,
players, `protocolVersion`), room-code generator (`generateRoomCode` /
`isValidRoomCode`), and `canStart`. The server keeps richer per-member data
(secret token, `socketId`, grace timer) that never leaves it. The `RoomState`
sketch below is the eventual *in-game* server state — a superset that adds
`controls`, `instructions`, `ship`, `seed`.

```ts
interface Player {
  id: string;                 // persistent; survives reconnect
  nickname: string;           // unique within the room, case-insensitive (D46)
  isHost: boolean;
  connection: "connected" | "disconnected";
  // server-only: token, socketId, graceTimer
}

type RoomPhase = "lobby" | "playing" | "gameover";

interface RoomState {
  code: string;               // 4-char shout-friendly code
  phase: RoomPhase;
  seed: string;               // logged; makes a session reproducible
  players: Player[];
  controls: ControlInstance[];      // all panels; server-side full view
  instructions: Instruction[];      // all active; server-side full view
  ship?: ShipState;                 // Stage 5+
  protocolVersion: number;
}

// Implemented (Stage 5) — sent inside PlayerView, not RoomState:
interface ShipView {
  health: number; maxHealth: number;   // 0..100; game over at 0
  progress: number;                    // instructions the crew has completed
  level: number;                       // 1 + floor(elapsedMs / 20_000)
  elapsedMs: number;
  phase: "playing" | "gameover";
  overReason?: "health" | "crew";
}
```

**The loop (`apps/server/src/game.ts`, `Game.step()` at 1 Hz):** expire overdue
instructions → `health -= difficultyFor(level).expirePenalty`, issue a
replacement; top each player to `difficultyFor(level).instructionsPerPlayer`;
`health` heals a little on completion (capped 100); at `health <= 0` →
`overReason: "health"`; below 2 players → `overReason: "crew"`. No passive drain.
Difficulty ramps every 20 s (shorter deadlines, more concurrent instructions).

### Per-player view (what actually goes over the wire)

**Implemented (Stage 3, `buildPlayerView`).** The server filters before sending;
each socket gets only:

```ts
interface PlayerView {
  room: RoomView;                 // public (code, phase, PublicPlayer[], protocolVersion)
  you: string;                    // this player's id
  panel: ControlInstance[];       // only controls where ownerPlayerId === you
  instructions: InstructionView[]; // only shownToPlayerId === you, status active
  ship: ShipView;                 // public
}
interface InstructionView {
  id; controlId; controlLabel; text;
  remainingMs; totalMs;           // relative time — no phone/Mac clock skew
}
```

A player never receives other players' control state, instruction objects, or
absolute server timestamps. Sent on `game:view` every tick, after every change,
and on resume.

---

## Control complexity & panel complexity

`CONTROL_COMPLEXITY: Record<ControlType, number>` — a **1–10** score (headroom for
future types), roughly *how much attention and physical interaction one control
demands of one player*. On the **type**, never the name.

| ControlType | complexity |
|---|---:|
| button | 1 |
| toggle | 2 |
| direction | 3 |
| shapeSelector | 3 |
| slider | 5 |
| dial | 5 |
| hold | 6 |
| mash | 7 |

`getPanelComplexity(controls)` = `Σ CONTROL_COMPLEXITY[c.definition.kind]`.

`generatePanels` (Stage 4) balances players by keeping **panel-complexity
totals** close — *not* by giving everyone the same control count. It fills each
panel greedily toward `TARGET_PANEL_COMPLEXITY` (15), 4–6 controls, choosing
types by how close their weight is to what's still needed and penalising repeats.
Observed totals land ~12–19 with a within-game spread of ≤ ~5. Seeded and the
seed is logged. Not sophisticated — the simple version per master prompt §7.

### Complexity is not task difficulty

Control complexity ≈ one control's demand on one player. **Task difficulty** —
deadlines, concurrent tasks, synchronized multiplayer actions, communication
load, critical-event conditions, and **slider tolerance** (`± 10` easy → `± 0`
hard) — is separate and must never be folded into the base complexity score.

---

## Instruction targeting rules

1. `shownToPlayerId` is chosen by the scheduler (round-robin / balanced so no player is
   starved or flooded).
2. The **target control** is chosen independently: pick any active control instance in the
   room, weighted so instruction load is spread across owners.
3. A minority of instructions (~1 in 5) resolve to a control the recipient owns — this must
   remain *possible* and *not special-cased*.
4. Never reuse a control already referenced by another active instruction.
5. Avoid immediately repeating the previous instruction for that player.

---

## Validation (server, authoritative)

`validateIntent(room, playerId, intent)`:

1. Resolve the control instance by `intent.controlId`; confirm `ownerPlayerId === playerId`.
2. Type/range-check `intent.value` against the definition.
3. Apply it to `control.state`.
4. Scan **all active instructions** for one where `controlId` matches and the new state
   satisfies `expected`.
5. If found → mark `completed`, apply gameplay effects (Stage 5+), schedule a replacement
   for that instruction's `shownToPlayerId`.
6. If not found → no-op (not an error; the player may just be exploring or mid-coordination).

Completion is decided **only** here. Clients never report success.

---

## Stage map for this model

| Stage | Adds to the model |
|---|---|
| 1 | Full control model: `ControlType` (8), `ControlDefinition`, `ControlName` registry + `compatibleTypes`, `ControlInstance` (`instantiateControl`), `CONTROL_COMPLEXITY`, `getPanelComplexity`, `hasUniqueLabels`. First task primitive `SliderTask` + `isSliderValueAccepted`. Local interaction only; `hold`/`mash` multiplayer semantics deferred to 6/7. |
| 2 | `Player`, `RoomState.code`, persistent `playerId`, `connection` |
| 3 | ✅ `Instruction` + `ExpectedOutcome`, `Intent`, `generatePanels` / `generateInstructions` / `nextInstruction`, pure `validateIntent`, `buildPlayerView` + `game:view` per-socket serialization. button/toggle/shapeSelector. Server-authoritative completion + replacement. No timers/health. |
| 4 | ✅ `generatePanels` → 4–6 controls/player of all six `GAME_TYPES`, balanced by total complexity (not count); ~42 provisional names; `ExpectedOutcome`/`validateIntent`/`instructionText` for direction/slider/dial; `nextInstruction` avoids re-targeting the just-completed control; seed logged. |
| 5 | ✅ Server 1 Hz `Game.step()`; instruction `deadlineAt`/`totalMs` + `status:"expired"`; `ShipView` (health/progress/level/elapsed); `difficultyFor`/`levelForElapsed` ramp; game over at 0 health or < 2 players; `room:restart`; `InstructionView` relative-time wire format; mid-game `Game.removePlayer`. |
| 6 | `hold` kind, `HOLD_STARTED/ENDED`, synchronized-hold condition |
| 7 | `mash` kind, shared/independent tap counters |
| 8 | critical events: compound conditions over multiple instructions |
