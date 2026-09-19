# DECISIONS.md — Overcrew

Chronological log of decisions that would otherwise be re-litigated or rediscovered.
One entry per decision. Keep it terse.

---

## 2026-08-31 — Stage 0: research + architecture

### D1. Stack: TypeScript + React/Vite + Node + Socket.IO + shared package
Server-authoritative, event-driven, in-memory rooms. Rejected Colyseus and boardgame.io
(framework lock-in, sync models heavier than our low-frequency event traffic needs) and raw
`ws` (would re-implement rooms, acks, reconnect). No database — rooms are intentionally
ephemeral. See `ARCHITECTURE.md §2`.

### D2. Monorepo: `apps/web`, `apps/server`, `packages/shared`
npm workspaces (built in, no extra tooling). All pure game logic (panel/instruction
generation, balancing, validation, seeded RNG) lives in `packages/shared` so it is
unit-testable without a browser and shared verbatim by client and server.

### D3. Room codes, not UUIDs
4 uppercase chars from an alphabet with no vowels and no ambiguous glyphs (`0 1 I O`
excluded) → shout-friendly, collision-resistant, no accidental words. OpenSpaceTeam's
`uuid4` room ids are a known usability wart we are not repeating.

### D4. Persistent identity + grace-period reconnection
Each player gets a persistent `playerId` + `token` (stored in `localStorage`), issued on
first connect. Socket id is transport-only, never identity. On disconnect the seat is marked
`disconnected` and held ~60 s; the game does **not** end. OpenSpaceTeam disposes the whole
game on any disconnect — the single biggest flaw in the reference implementation. Minimal
version lands in **Stage 2** (moved earlier than the master prompt implies) because it is
expensive to retrofit.

### D5. Per-player state filtering on the server
Server holds full `RoomState`; each client receives only its own panel, its own
instructions, and public room/ship state. Pattern borrowed from boardgame.io `playerView`.
Never broadcast full state and filter client-side. Applies from **Stage 3** (first private
state).

### D6. Snapshot-then-events sync; protocol version on every payload
Full per-player snapshot on (re)connect, targeted events afterwards. Every message carries
`PROTOCOL_VERSION`; mismatch → client asks user to refresh rather than misbehaving.

### D7. No game loop; one ~1 Hz timer from Stage 5
Instruction deadlines and health drain run on a single low-frequency timer introduced in
Stage 5. Stages 1–4 have no timers at all. Overcrew is event-paced, not an action game.

### D8. Control definition / instance / layout are separate
`ControlDefinition` (mechanic) vs `ControlInstance` (named, owned, stateful) vs on-screen
layout (client-only, a vertical stack of 4–6). The server never models grid geometry.
OpenSpaceTeam couples all three in one generation pass — explicitly rejected.

### D9. Roadmap deltas from the master prompt
(a) Stage 1 also writes the `packages/shared` model skeleton (`model.ts`, `rng.ts`,
`protocol.ts` version) — rendering only, no generation/networking.
(b) Room codes from Stage 2.
(c) Minimal reconnection in Stage 2.
(d) Per-player serialization from Stage 3.
(e) Build the "server-side progress accumulator" abstraction once in Stage 6; Stage 7
reuses it. Separate test checkpoints kept.
Core milestone unchanged: cross-player instruction→control→validate loop = Stage 3.

### D10. UI language / naming
Game UI and instructions in Russian; game name "Overcrew" stays English. Instruction text
always contains the control name verbatim and never implies ownership
(no "твоя задача" / "свой"). Panel header wording stays neutral ("ИНСТРУКЦИИ").

### D11. Instruction targeting independence is a hard invariant (planned)
`instruction.shownToPlayerId` and `control.ownerPlayerId` may be equal or different; ~1 in 5
instructions target a control the recipient owns, and this is never special-cased. Tests in
`packages/shared` must assert both the equal and unequal cases occur.

---

## 2026-08-31 — Stage 1: mobile UI playground

### D12. Toolchain: Node installed via Homebrew; npm workspaces
Node was not present on the dev machine; installed `node` via Homebrew (currently
v26, npm 11). Monorepo uses **npm workspaces** (no pnpm). Packages:
`@overcrew/shared` (TS source consumed directly, `main`/`exports` → `src/index.ts`)
and `@overcrew/web` (React 18 + Vite 5). Root scripts: `npm run dev`, `npm test`,
`npm run typecheck`.

### D13. Web consumes `@overcrew/shared` from TS source, not a build
`vite.config.ts` sets `optimizeDeps.exclude: ["@overcrew/shared"]` so Vite
transpiles the shared source on the fly and HMR covers shared changes. `tsc`
resolves it via the package `types` field. No build step for `shared`.

### D14. Stage 1 shared surface: `protocol.ts`, `rng.ts`, `model.ts`, `panel.ts`
Per the roadmap delta D9(a). `ControlKind` is exactly the six Stage 1 kinds
(button, toggle, selector, direction, knob, slider); `hold`/`mash` are added in
their own stages, not stubbed now. `COMPLEXITY_WEIGHTS` is a standalone map (the
single source of weights) rather than a field on each `ControlDefinition`.
`createSamplePanel()` is a fixed hand-authored panel — **no generation yet**
(that is Stage 4).

### D15. Control widgets are data-driven and mechanic-separated
`ControlRenderer` switches on `definition.kind`; each mechanic is its own
component receiving a semantic `ControlEvent`. Layout is a plain vertical stack in
CSS — the model carries no geometry (D8). Knob and slider use discrete −/+ pads
plus tappable stops rather than drag, per docs/GAME_MODEL.md ("early prototypes").

### D16. Verified headlessly with Playwright/Chromium
No `chromium-cli` on the machine; installed `playwright` + Chromium in the
scratchpad (not a repo dependency) to screenshot and drive the playground at a
390×844 mobile viewport. Real-phone testing on the LAN remains the Stage 1
acceptance check.

### D17. Finalized the Overcrew V1 control alphabet — exactly eight kinds
`button, toggle, direction, selector, slider, knob, hold, mash`. No more control
types will be added in V1 (compound controls — sequences, keypads, linked
controls — are explicitly out). `packages/shared` `ControlKind` is now this full
set; `createSamplePanel()` is the eight-control demo alphabet (not a player
panel, which stays 4–6 and is generated in Stage 4). `hold` and `mash` are
implemented as **local interaction only** — their multiplayer semantics
(synchronized hold, team mash) are still Stage 6 / Stage 7.

### D18. ТУРБОЖАБА is a shape selector; shape is the value
Values are the four geometric glyphs `● ▲ ■ ◆` (`SHAPES` in `panel.ts`), all
shown at once as a segmented control. Colour is never part of the semantic value.
The generic `selector` mechanic is unchanged — only this instance's values.

### D19. ФАЗОВРАЩАТЕЛЬ knob is directly dragged, no +/- buttons
The knob is rotated by touching the dial and dragging around its centre; on
release it snaps to the nearest of 8 positions. Implemented with **Pointer
Events** (one path for mouse + touch), `setPointerCapture`, and `touch-action:
none` to suppress page scroll during the gesture. The visual angle is
**accumulated from pointer-angle deltas**, not derived from one absolute angle,
so crossing the −180°/+180° boundary never makes the dial jump. Positions are
stored 0-indexed and presented 1-indexed (1–8). Arrow keys nudge it for
accessibility; there is deliberately no visible increment/decrement fallback.

### D20. Playground widgets remount on СБРОС
`PlaygroundState.generation` is bumped on reset and folded into each control's
React `key`, so widgets with internal state (hold progress, dial drag angle) are
cleared cleanly rather than reconciled.

---

## 2026-08-31 — Stage 1: control-model refactor (type / name / instance / complexity)

### D21. Control type, name, instance and complexity are four separate concepts
The model must scale to ~24 control instances across 4 players (4–6 each), with
interaction types repeating freely. So:

- **ControlType** — the interaction: `button, toggle, direction, shapeSelector,
  slider, dial, hold, mash`. Exactly these 8 for V1; no compound controls yet.
  (Renamed from the earlier `ControlKind`; `knob`→`dial`, `selector`→
  `shapeSelector`.)
- **ControlName** (`names.ts`) — a curated visible label plus `compatibleTypes`,
  the interaction types that name may be instantiated as. The model deliberately
  does **not** assume "one name = one type forever", but `compatibleTypes` is
  hand-curated to avoid nonsense (e.g. `ДАВЛЕНИЕ` → `["slider","dial"]`,
  `ФАЗОВРАЩАТЕЛЬ` → `["dial","toggle"]`; the button pool stays `["button"]`
  until we decide otherwise). Name pools are approved manually in small batches
  so the spoken vocabulary stays distinct under noise — no auto-generated pools.
- **ControlInstance** — `{ id, nameId, label, definition, ownerPlayerId?, state }`.
  `definition.kind` is the type and carries params (slider range, dial positions,
  selector values). `label` is denormalized from the name registry.
  `instantiateControl(id, nameId, definition)` resolves the label and throws if
  the definition's type is not in the name's `compatibleTypes`.
- **ControlComplexity** — `CONTROL_COMPLEXITY: Record<ControlType, number>` on a
  **1–10** scale (scale headroom for future types), attached to the TYPE, never
  the name: `button 1, toggle 2, direction 3, shapeSelector 3, slider 5, dial 5,
  hold 6, mash 7`.

### D22. Panel complexity = sum of control TYPE complexity
`getPanelComplexity(controls)` sums `CONTROL_COMPLEXITY[c.definition.kind]`. A
future Stage 4 generator balances players by keeping these totals close, not by
equal control counts — one player may hold 4 heavy controls, another 6 light
ones. No generator is built yet.

### D23. Control complexity is not task difficulty
Control complexity ≈ how much attention/physical interaction one control demands
of one player. Task difficulty (deadlines, concurrent tasks, synchronized
actions, communication load, critical events) is separate and must never be
folded into the base complexity score.

### D24. Unique visible names within one active game
`hasUniqueLabels` / `duplicateLabels` enforce that no two live controls share a
label (players shout names). Different matches may reuse names. Repeated
interaction *types* are expected and never constrained.

### D25. Stage 1 playground names are examples, not definitions
`ПЛАЗМОНАСОС, КРИОКЛАПАН, ГИРОСКОП, ТУРБОЖАБА, ДАВЛЕНИЕ, ФАЗОВРАЩАТЕЛЬ,
СТАБИЛИЗАТОР, ИМПУЛЬСАТОР` remain the eight playground instances, but are now
understood as one example instance per type. Approved wider pools so far: the
five `button` names (`ПЛАЗМОНАСОС, АВАРИЙНЫЙ СБРОС, ИОННЫЙ ПУСКАТЕЛЬ, КВАНТОВЫЙ
ЗВОНОК, ТУРБОСТАРТЕР`). Preserved interaction behaviour unchanged: shape
selector `● ▲ ■ ◆`, drag-only 8-position dial, local hold/mash. Minor UI: mash
label `ДАВИ` → `ЖМИ`.

---

## 2026-08-31 — Stage 1: precise slider + first task primitive

### D26. Slider is a continuous drag with an integer 0–100 value
The `ДАВЛЕНИЕ` slider changed from coarse 10-step taps to
`{ min: 0, max: 100, step: 1 }` with a **directly-draggable thumb** (Pointer
Events, `touch-action: none`, keyboard `role="slider"` with arrows/PageUp-Down/
Home/End). The motion is continuous; the stored value is always an integer. The
current value is shown as a large prominent number by the control (and the
duplicate header readout is suppressed for the slider only). One `slider` event
is emitted per settle — pointer-up or key press — not per drag frame, so the
event log stays readable.

### D27. First task primitive: `SliderTask { targetValue, tolerance }`
A slider instruction targets an approximate value: `ДАВЛЕНИЕ → 67 ± 3` accepts
64–70 inclusive. `packages/shared/src/tasks.ts` holds `SliderTask`,
`sliderTaskRange` (inclusive, **clamped to [0, 100]** — `97 ± 5` → 92–100), and
`isSliderValueAccepted` (≡ `Math.abs(value - target) <= tolerance`, both bounds
inclusive, clamped). `tolerance: 0` means the exact value. This is the only task
primitive so far — no generator, no difficulty scoring.

### D28. Tolerance is task difficulty, not control complexity
`CONTROL_COMPLEXITY.slider` stays **5** regardless of tolerance. Tolerance lives
in the task model: larger → easier, smaller → harder (`± 0` hardest). Never fold
it into the base control-complexity score (see D23).

### D29. Never draw the tolerance band on the slider
The accepted range is not shown on the track — no coloured target zone. The
player hears/reads the requested value + tolerance and reaches it using the
numeric readout. Showing the zone would remove the communication challenge. The
playground *does* flash a post-release SUCCESS/`МИМО` indicator (local only).

---

## 2026-08-31 — Stage 2: room & lobby (multiplayer networking)

### D30. `apps/server` — one Node process, Socket.IO, in-memory rooms
`socket.io` v4 on a bare `http` server bound to `0.0.0.0:3001` (`PORT`/`HOST`
env). Dev CORS is `origin: true`. `RoomManager` holds `Map<code, Room>` and
`Map<token, code>` — no database, rooms vanish on restart (acceptable, per D1).
Root `npm run dev` runs server + web together via `concurrently`.

### D31. Client finds the server from `window.location.hostname`
The web client connects to `${protocol}//${hostname}:3001`, so a phone that
loaded the page from `http://<mac-ip>:5173` reaches the server at
`http://<mac-ip>:3001` with no configuration. `VITE_SERVER_URL` /
`VITE_SERVER_PORT` override it. Production (Stage 10) will serve the client from
the server's own origin — the same derivation still works.

### D32. Identity = persistent `playerId` + secret `token`, in `localStorage`
Issued by the server on create/join, stored client-side as a `Session`
(`{ playerId, token, roomCode }`). The Socket.IO socket id is transport only,
never identity. On (re)connect the client emits `room:resume { token }` to
reclaim its seat; a bad/expired token clears the session and drops the player to
the start screen. Implements DECISIONS D4.

### D33. 60 s disconnect grace; the room is never destroyed by a disconnect
`disconnect` marks the seat `disconnected` and starts a 60 s timer
(`GRACE_MS`). Only when that timer fires is the player removed — and only then is
a new host promoted (earliest joiner, preferring a connected one) or the room
disposed if it is now empty. A `resume` within the window cancels the timer.
This is the single biggest fix over OpenSpaceTeam, which nukes the whole game on
any drop.

### D34. Stale-socket guard
`markDisconnected(token, socketId)` starts the grace timer only if that socket
still owns the seat (`member.socketId === socketId`). A second tab or a fast
reconnect rebinds the seat to the new socket, so the old socket's later
`disconnect` is ignored — no spurious "disconnected" flicker.

### D35. Protocol shape
Client→server events (`room:create/join/resume/leave/start`) all take a request
object + a typed `Ack<T>` callback (`{ ok:true, data } | { ok:false, error, message }`).
The server pushes `room:state` (a `RoomView`: code, phase, `PublicPlayer[]`,
`protocolVersion`) to the whole room on every change. The client derives `youId`
(from its session) and `canStart` (`shared/room.ts`) locally; the server
re-validates start server-side. `PublicPlayer` never carries the token.

### D36. Stage 1 playground kept at `#playground`
The default route is the Stage 2 room flow; `location.hash === "#playground"`
still renders the control playground for hardware testing.

---

## 2026-08-31 — Stage 3: first cross-player mechanic

### D37. Provisional name-pool expansion
`packages/shared/src/names.ts` grew from 12 to 21 names so a 2–5-player game has
enough distinct labels: `button` 5 → 7, `toggle` 1 → 5, `shapeSelector` 1 → 4.
The new `toggle`/`shapeSelector`/extra-`button` names are **provisional** —
generated in the requested style but not yet through a spoken-vocabulary review.
Flag for approval.

### D38. Stage 3 panel generation — `generatePanels` (shared, pure, seeded)
On `room:start` the server builds one panel per player: prefers one each of
`button` / `toggle` / `shapeSelector`, borrows another type when a name pool runs
dry (repeated types are fine, D17), scales `perPlayer` down (3 → 2) as players
grow so labels stay globally unique (`hasUniqueLabels`). Generation uses only
names dedicated to a single type (so `ФАЗОВРАЩАТЕЛЬ`/`ДАВЛЕНИЕ` are never
instantiated as an off-type control here). No balancing by complexity yet
(Stage 4).

### D39. Instruction model — `Instruction` + `ExpectedOutcome`
`{ id, controlId, controlLabel, shownToPlayerId, expected, text, status }`.
`expected` is `press { fromCount } | toggle { on } | select { value }` — fully
state-based (a button press is "pressCount increased since the instruction was
made"), so completion is a pure predicate over `ControlState`. `text` always
contains `controlLabel` verbatim (`ТУРБОЖАБА → ◆`, `НЕЙТРОННЫЙ КРАН → ВКЛ`).

### D40. Targeting independence, enforced and tested
`nextInstruction`: with probability `SELF_TARGET_CHANCE` (0.2) the target owner
is the recipient; otherwise it is explicitly someone else. Among the allowed
owners, the one with the fewest active instructions pointed at them is preferred;
controls already targeted by an active instruction are skipped. Tests assert both
self- and cross-targeting occur and that self is the minority.

### D41. `validateIntent` is the single authority, and it is pure
`validateIntent(game, playerId, intent)` (shared) mutates nothing: it returns the
control's next state and the id of any instruction the intent completes. The
server applies the result, retires the completed instruction and issues a
replacement for the same recipient via `nextInstruction`. Acting on a control
that matches no instruction is a valid no-op. Clients never decide success.

### D42. Per-player serialization from Stage 3 (`PlayerView`)
The server sends each socket only `buildPlayerView(room, playerId, game)` —
public room state + that player's own panel + that player's own instructions.
Other players' controls and instructions never leave the server. New events:
`game:intent` (client→server, `Intent`) and `game:view` (server→client,
`PlayerView`). `game:view` is re-sent on every game change and on resume.

### D43. In-game disconnect is not fully handled yet
A player who drops mid-game keeps their controls/instructions in the game state;
instructions targeting them can't be completed until they return (their seat is
held 60 s as in Stage 2, and resume re-sends their `PlayerView`). If they never
return the game can stall. Proper mid-game player-loss handling is deferred to
Stage 5 (timers / failure).

### D44. Join errors are surfaced; the join button is never a silent dead-end
Reported: joining with a bad code did nothing — the button was client-gated on
`isValidRoomCode` and just sat disabled. Fix: the button is enabled whenever a
code is present; the **server** validates it and returns "Неверный код" /
"Комната не найдена", shown in the error banner. `enter`/`start` now also refuse
when the socket is disconnected ("Нет связи с сервером") and time out after 6 s
("Сервер не отвечает"). The connect splash falls through to the pre-lobby
(offline state) after 4 s so an unreachable server is never an infinite spinner.

### D46. Nicknames are unique within a room
`joinRoom` rejects a nickname already held by any member — including a
disconnected one still inside its 60 s grace window — with
`AckError "nickname_taken"`. Comparison is case-insensitive on the normalized
nickname. Players coordinate by shouting names, so two "Метеор" in one room is
not allowed; the joiner gets an error and picks another. Different rooms are
independent.

### D45. Host badge is "КАПИТАН"; space-themed default callsigns
The host badge label changed from ХОЗЯИН to КАПИТАН (also the lobby/PreLobby copy
and the server's not-host error). `DEFAULT_NICKNAMES` (10 space words) lives in
`shared/room.ts`; the PreLobby offers one as a grey placeholder with an "↻
другой" reshuffle, and submitting an empty field uses the shown suggestion.

---

## 2026-08-31 — Stage 4: randomized balanced panels

### D47. Provisional name pools expanded to ~42
`names.ts` now has ~7 names per game type (`toggle` +2, `shapeSelector` +3,
`direction` +6, `slider` +6, `dial` +7). Enough for a 4-player game (~24
controls). **All the non-`button` names remain provisional** and still want a
spoken-vocabulary review.

### D48. Panels are 4–6 controls, balanced by total complexity not by count
`generatePanels` fills each panel greedily: pick a type by "how close its 1–10
complexity is to what's still needed per remaining slot", penalise a type
already stacked on this panel (so no one gets 4 selectors), add a little jitter
so heavy types (slider/dial = 5) still show up. Stop once the panel has
≥ `MIN_PANEL_CONTROLS` (4) *and* total ≥ `TARGET_PANEL_COMPLEXITY` (15), or hits
`MAX_PANEL_CONTROLS` (6). Observed: panels 4–6 controls, totals ~12–19, spread
within one game ≤ ~5, every type appears regularly, ≤ 3 of any one type per
panel. All labels globally unique; seed logged. Master prompt §7's "sophisticated
algorithm not needed initially" — this is the simple version.

### D49. Six control types in play; slider/direction/dial expectations
`GAME_TYPES` = button, toggle, direction, shapeSelector, slider, dial (was 3).
`ExpectedOutcome` gained `direction {value}`, `slider {task: SliderTask}`,
`dial {position}`; `validateIntent` / `applyIntentToControl` / `expectationMet` /
`instructionText` handle them. Slider instructions are `L → target ± tolerance`
(reusing `SliderTask` / `isSliderValueAccepted`); the acting player's slider
still never shows the tolerance band (D29) — they hit it from the shouted number.
`hold`/`mash` stay out until Stages 6/7.

### D50. Replacement instruction never re-targets the just-completed control
`nextInstruction` takes an optional `avoidControlId`; `Game.applyIntent` passes
the completed control's id so the next instruction for that recipient points
somewhere else.

---

## 2026-08-31 — Stage 5: timed game loop

### D51. The 1 Hz loop lives on the server `Game`; deadlines drive the pressure
`Game.step()` runs once per second (`setInterval`, injectable clock for tests):
expire overdue instructions, drain `health` by `difficulty.expirePenalty`, issue
replacements, top each player up to `difficulty.instructionsPerPlayer`, and end
the game at ≤ 0 health. No passive health drain — missing deadlines is the only
way to lose health; completing an instruction heals a little (`completeHeal`,
capped at `MAX_HEALTH` 100). This is the first server timer (DECISIONS D7).

### D52. Difficulty ramps by elapsed time
`levelForElapsed(ms)` = 1 + floor(ms / 20 000). `difficultyFor(level)`:
`deadlineMs` 22 s → floor 6 s (−2 s/level), `instructionsPerPlayer` 1 → 2 (L3)
→ 3 (L6), `expirePenalty` 6 + level. A "do nothing" 2-player game dies in ~75 s;
a playing 3–4-player crew lasts ~2–3 min before the ramp outruns them. Difficulty
is *coordination pressure* (more concurrent tasks, shorter deadlines), never
fiddlier controls (master prompt §13 Stage 5).

### D53. `RoomPhase "gameover"`; host restarts
At 0 health the server sets `room.phase = "gameover"` and broadcasts a final
`game:view` with `ship.phase = "gameover"` + `overReason`. The host gets a
`room:restart` action (ЗАНОВО) that disposes the game and returns the room to
`lobby`; others wait. `game:view` is broadcast every tick so the client can show
a live timer / countdown bars (interpolated between the 1 Hz updates).

### D54. Wire format: `InstructionView` (relative time), `ShipView`
The client never sees absolute server timestamps. `buildPlayerView` maps each
instruction to `{ …, remainingMs, totalMs }` (relative — no clock-skew between
phone and Mac) and adds `ShipView { health, maxHealth, progress, level,
elapsedMs, phase, overReason? }`.

### D55. Mid-game player loss is handled (was D43)
`Game.removePlayer(playerId)` (called from `RoomManager.onMemberDropped` when a
seat's 60 s grace expires or the player leaves) removes their controls, retires
instructions that referenced them (re-issuing ones still owed to a remaining
player), and ends the game with `overReason "crew"` if fewer than two players
remain. A player who drops and returns *within* the grace window resumes
normally and gets a fresh `game:view`.

---

## 2026-08-31 — Gameplay panel layout redesign

### D56. Gameplay screen is a non-scrolling instrument panel
The vertically-scrolling list of large control cards is gone. `GameScreen` is
`100dvh; overflow: hidden` with `body.no-scroll`; the instruction strip + the
whole panel are always visible (core requirement — scrolling to find a control
is friction, not difficulty). Minimum supported gameplay viewport: **≈ 360 × 620
usable px**. Full rules in `docs/PANEL_LAYOUT.md`.

### D57. `ControlType` ≠ layout footprint; slider has an orientation
`apps/web/src/game/layout.ts` (`chooseLayout`) — a small deterministic curated
system, NOT a bin-packer — assigns each control a footprint on a 4-column
lattice (button `2×1`/`2×2`/`4×1`, dial & direction `2×2`, shapeSelector `4×1`,
slider `4×1` horizontal or `2×2` vertical) and first-fits them into an exact row
count so the panel never overflows. `SliderControl` gained an `orientation` prop
(same 0–100/step-1 + tolerance behaviour either way). Variety comes from footprint
choice, slider orientation and a one-per-panel "feature" promotion — no
procedural packing engine (YAGNI).

### D58. Widgets fill their cell; state lives in the control
Widget CSS for the panel is scoped to `.pc__widget` (the Stage 1 playground's
`ControlCard` is untouched) and uses container-query units so dial ticks / fonts
scale to the cell. The `.pc` housing is a thin border, not a padded card. The HUD
is one compact strip; the instruction strip is capped at `32dvh`. Control names
(`.pc__name`, bold, up to 2 lines) are the scanning priority after the
instructions themselves. Extracted `ControlWidget` (bare surface) shared by the
playground's `ControlRenderer` and the gameplay `PanelGrid`.

### D59. Player-facing copy cleanup
Removed the `STAGE 3` dev label and `кооперативный крикун` from the start screen;
subtitle is now `shouting co-op game`.

### D60. Layout dead-space fix — candidate scoring + hole-filling
`chooseLayout` now tries several candidate footprint sets (taller vertical
sliders `2×3`/`2×4`, all-horizontal sliders, feature button, promoted small),
scores each (`−deadCells·8 − rows·1.5 + longSlider + feature + variety`), and
runs `fillHoles` on the winner — a `2×1` Button/Toggle/Hold/Mash directly above
an empty cell grows down into it. The reported `[slider,direction,dial,
shapeSelector]` panel now puts the vertical slider at a full `2×4` with no dead
space and a much longer track. Still not a bin-packer — ≤ ~8 candidates, a
one-line score.

### D61. Standard Button is a round physical push button
Was a rectangular app button with a press counter and "НАЖАТЬ". Now
`ButtonControl` renders a round pressable cap (`.pushbtn__cap`) — no counter, no
label, obvious idle / depressed / just-activated (cyan flash) states, size scales
with the cell via `cqmin`, never distorted to a rectangle. "НАЖАТЬ" stays in the
instruction stream (task language), not on the control. Mash keeps its `N / 12`
counter + progress and its rectangular shape so Button ≠ Mash is obvious. The
`pressCount` prop is gone from `ButtonControl` (the server still tracks it for
validation).

---

## 2026-09-01 — Stage 6: hold mechanics

### D62. `hold` is a game type; server owns hold state
`GAME_TYPES` now includes `hold`. `ControlState.hold` changed from
`{ completed }` to `{ held }` (reflected per-player from the server). New intents
`hold-start` / `hold-end`; the client `HoldControl` emits them on pointer
down/up (optimistic pressed state, confirmed by `held`). Completion is purely
time-based — decided by `Game`, never by the client or a state snapshot
(`expectationMet` returns `false` for hold/syncHold).

### D63. `Game.held` map + one-shot timer
`Game` keeps `held: Map<controlId, heldSinceMs>`. Solo hold completes when the
control has been held for `expected.forMs` continuously; `holdComplete` /
`holdProgressMs` (shared, pure) compute it. Checked on every hold intent, on a
`setTimeout` scheduled for the soonest completion (so latency is ~0, no fast
tick), and each 1 Hz step as a backstop. A disconnect (`releaseHolds`) or a
grace-expiry drop (`removePlayer`) releases that player's holds; expiry of a hold
instruction clears its controls too.

### D64. Synchronized hold — `ExpectedOutcome "syncHold"`
`{ kind: "syncHold", forMs, withControlId, withControlLabel }` on an instruction
whose primary `controlId` is the other control. Both must be held at once;
progress = `now − max(heldSinceA, heldSinceB)` while both are held, **0 the
instant either is released** (the "reset" rule). `generatePanels` guarantees ≥ 2
hold controls on ≥ 2 owners for any ≥ 2-player game (converting the control that
disturbs panel complexity least); `nextInstruction` emits a syncHold with
`SYNC_HOLD_CHANCE` (0.4) when ≥ 2 free hold controls exist. Text:
`A + B → УДЕРЖАТЬ ВМЕСТЕ 3с`.

### D65. Hold instructions get a generous deadline; progress bar is green
`addInstruction` extends a hold/syncHold deadline by `forMs + 5000` — the
coordination is the challenge, not the clock. `InstructionView.hold =
{ heldMs, forMs }`; the instruction row shows a green fill (hold progress)
instead of the red countdown while it's a hold. The hold control shows a pulsing
"ДЕРЖИМ" while held. `mash` stays out until Stage 7.

---

## 2026-09-05 — Lobby roster rework: physical asset fit + presence-only state

### D66. Crew roster reworked to fit taller regenerated panel art
The waiting-room roster plate was regenerated taller (`crew-panel.webp`,
1167×986 vs. the old 1326×794) so the header band and 4 row slots fit the
panel's own carved groove without leaving dead flat-metal space to the right
of the rows. It keeps the full 90% chassis width every other module uses; its
top edge lines up with screen 1's first module (`.brand`, `top: 29.5%`) so the
two screens read as aligned, with a clear gap under the viewport. The header
sits in the flat metal band *above* the groove's raised frame (frame edge
~17.5% of the panel), shifted in past the corner screws, title left / count
right on a shared baseline. Both are treated as **engraving cut into the
metal**, not lettering printed on top: a muted aged-brass colour close to the
plate itself, a thin dark rim at the top edge and a faint lit rim at the
bottom (`text-shadow` only, no glow, no outward drop shadow) — the count a
half-step lighter than the title. `.crew__rows` sits inside the groove
(`top: 21%`, `height: 62%`) with a small `padding-top` — rows stack from the
top and never centre vertically when the crew is small. No placeholder rows
for absent players.

### D67a. START plate status strip + engraved label states
Below "НАЧАТЬ", in the flat area right of the actuator, `.plate__status` shows
one always-present line (fixed slot, so "НАЧАТЬ" never shifts): `НУЖЕН ЕЩЁ 1
ИГРОК` (captain alone), `ЭКИПАЖ СОБРАН` at 2–8, `ОЖИДАЕМ КАПИТАНА` for
non-captains. It is a deliberately recessive secondary hint — muted amber
(muted green for "собран"), light weight, **no glow** — sized to still read on
a phone. "НАЧАТЬ" itself: engraved like ЭКИПАЖ but a shade darker in the
disabled state (part of the panel, not lit), warm and bright in the active
state; identical box in both so nothing moves. The badge (`.crew__badge`)
sits fully inside the row bar's dark inset with a clear margin from the inset
edge and corner screw, vertically centred; space for it is reserved by the
flex layout and the nickname ellipsises when width is short (not clipped by
`overflow: hidden`). The 2/8 limits and captain-only start stay enforced in
`rooms.ts` (`joinRoom` → "full", `canStart`), not just in the button's look.

### D67. Roster shows presence only — no ready state, no placeholder rows
A row exists only for a player who is connected *right now*; there is no
separate "ready" opt-in and no dimmed/placeholder row for a disconnected or
never-joined seat — a dropped phone (even mid-reconnect-grace) simply isn't
listed until it reconnects. Every rendered row is therefore a connected
player by construction, so its status LED is unconditionally lit — no on/off
branching. The captain and the START actuator are unaffected by this: only
the captain's `.plate` press starts the game, same as before any ready
mechanic existed.

### D68. Scrollbar uses the panel's own carved gutter, not a floating rail
The panel bakes a separate narrow vertical gutter next to the row groove.
`.crew__scroll` overlays the standalone track art (`scrollbar-track.webp`,
with its own baked up/down arrow caps) centred on that gutter, height-matched
to the rows band; it renders only while the roster actually overflows (roster
`scrollHeight > clientHeight`), not as a permanent decoration. The thumb
(`scrollbar-thumb.webp`) is the one element in this file whose box isn't a
fixed aspect-ratio — its height is set inline per-render from the real
`clientHeight / scrollHeight` fraction (same math as its `top`) — with a warm
brightness/drop-shadow filter marking it as the lit, moving part against the
dormant rail.

### D69. Per-row status LED is a glow through the row's own lens, not an overlay shape
`crew-row.webp` already paints a physical lens (bezel + frosted glass) at the
row's left end. `.crew__led` draws no disc of its own — an earlier pass still
had one, and it read as "two circles" competing with the painted lens. It's
now a single soft `radial-gradient` + `mix-blend-mode: screen` glow, sized a
little inside the measured glass so the bright core stays inside the lens and
only a thin halo reaches the surrounding metal bezel.

---

## 2026-09-16 — Out-of-plan: game telemetry & crash scoreboard

Implemented ahead of the roadmap at the user's request, after real playtesting
surfaced that "who actually caused the crash" was invisible. Spec:
`docs/Overcrew — Game Telemetry & Crash Scoreboard.md`.

### D70. Telemetry is an in-memory event log owned by `Game`, not a new system
`Game` (`apps/server/src/game.ts`) pushes `TelemetryEvent`s
(`packages/shared/src/telemetry.ts`) at its own existing state transitions —
`addInstruction`, `completeInstruction`, the expire loop in `step()`,
`removePlayer`, hold-start. No new subsystem, no persistence layer (none exists
in this project and this task doesn't justify adding one): the log is a plain
array on the `Game` instance, inspectable via `getTelemetry()` and dumped to the
console on game-over (`index.ts`) as the current "export" path. Nothing here
changes gameplay or timing.

### D71. Role vocabulary: "source" (recipient) vs "target" (control owner)
Reused the game's own invariant instead of inventing terms: an instruction's
**source** is `shownToPlayerId` (reads it, responsible for shouting it out);
its **target** is the owner of `controlId` (must physically act on it). These
are independent by design, so telemetry never conflates communication
contribution with execution contribution — a player's `transmitted` count
(source role) and `executed`/`failed` counts (target role) are tracked
separately (`ScoreboardView`/`PlayerScoreLine`).

### D72. "Transmission" = delivery to a connected socket; no speech recognition
Overcrew has no voice/speech input — "successfully transmitted" is defined as
the server actually delivering a `PlayerView` containing the instruction to the
source player's connected socket at least once. `index.ts`'s `broadcastGame` is
the only place that knows this, so it calls the new `Game.markSeen(id)` per
active instruction on every emit to a connected member; `Game` retroactively
records a failed transmission (`recipient_never_connected`) if an instruction
resolves without ever being seen. This is the literal, honest mapping of
"transmission telemetry" onto a shout-based game with no recognition step.

### D73. Only real terminal states are recorded — no fabricated ones
`InstructionResolution` is `"executed" | "expired" | "cancelled"` only.
`validateIntent` has no "executed incorrectly" or "invalid" state — an action
that doesn't satisfy the active instruction is a valid no-op, not a failure
(this predates telemetry, see `validateIntent`'s own docstring); inventing a
status the engine doesn't produce was explicitly out of scope. `"cancelled"` is
new and real: a player leaving orphans their instructions (`removePlayer`) —
that's neither a success nor a deadline miss, so it counts toward nobody's
`failed` total. Similarly `EndReason` is only `"health" | "crew"` — Overcrew is
an endless survival game with no "completed / won" outcome to report.

### D74. Crash causality: first expiry to actually zero the health, not a guess
`step()`'s expire loop now applies each expired instruction's penalty one at a
time and remembers the *first* one whose penalty brings health to ≤ 0 as the
`CrashCause` (`instructionId`, the control's owner as `responsiblePlayerId`,
`sourcePlayerId`, `targetControlId`) — later expiries in the same tick still
apply but aren't blamed. A `"crew"` game-over (too few players left) has no
instruction to blame, so `responsiblePlayerId`/`causedByInstructionId` are left
undefined rather than guessed. `buildScoreboard` (pure reducer, no separate
scoring logic) turns the event log into `ScoreboardView` once, cached on
`Game` at `endGame()` and attached to `PlayerView.scoreboard` from then on.

### D75. Scoreboard lives on the existing `GameOver` screen, same visual system
`GameScreen.tsx`'s `GameOver` renders `gv.scoreboard` as a compact per-player
row list (`.over__board*` in `styles.css`, matching `--surface`/`--edge`/
`--red`) below the existing top-level stats — no redesign, no new screen.
