# Overcrew — Game Telemetry & Crash Scoreboard

## Context

You are working on Overcrew, a browser-based cooperative shouting game.

The game is already playable in test sessions with friends. We have identified some bugs, but the current priority is to add reliable game telemetry and a crash scoreboard before expanding the design or adding new gameplay mechanics.

**Important:** This is an engine / game logic task, not a visual redesign task.

The approved visual direction is fixed: retro-space industrial control panel. Do not revisit, replace, or redesign the visual language.

---

## Goal

Implement two connected features:

1. A reliable telemetry system that records game sessions, player control assignments, instructions, instruction transmission, execution results, timing, failures, and crash causality.
2. A crash scoreboard that displays player performance and the instruction/player responsible for the crash.

The telemetry must be the source of truth for the scoreboard.

Do not implement a separate scoring logic that can diverge from the actual game state.

---

## Step 1 — Inspect the existing codebase

Before changing code:

1. Identify the game engine entry points.
2. Identify how games and levels are initialized.
3. Identify the data model for players.
4. Identify the data model for controls.
5. Identify how instructions are created.
6. Identify how instructions are transmitted / recognized.
7. Identify how instructions are assigned to target players and controls.
8. Identify how instruction deadlines are calculated.
9. Identify how execution is validated.
10. Identify how lives are reduced.
11. Identify how the game transitions to the crashed / game-over state.
12. Identify the current state management and persistence approach.
13. Identify the current test setup.

Read the relevant files and understand the existing architecture before implementing.

Do not assume the project uses a particular framework, backend, database, event bus, or state management library.

Do not rewrite the engine.

---

## Step 2 — Propose the implementation plan

Before writing the implementation, provide a concise plan covering:

- Where telemetry events will be generated.
- What data model will be used.
- Whether telemetry is stored in memory, persisted locally, sent to a backend, or some combination.
- How instruction lifecycle states will be represented.
- How timing will be measured.
- How crash causality will be determined.
- How the scoreboard will consume telemetry.
- What tests are needed.

Prefer the smallest architecture that is reliable and consistent with the existing project.

If a backend or database does not currently exist, do not introduce one merely for this task unless the repository clearly requires it.

---

# Feature 1 — Game telemetry

## 1. Game session metadata

Record a game session with:

- `game_id`
- `level_id`
- `level_version`, if available
- `engine_version`, if available
- `started_at`
- `ended_at`
- `end_reason`
- participating player IDs
- random seed, if the game uses randomness
- relevant difficulty configuration

Supported end reasons should include the existing game outcomes, such as:

- crashed
- completed / won
- abandoned
- disconnected
- error

Use the existing game terminology where possible.

Do not invent conflicting state names.

---

## 2. Player control assignments

Record the control assignment for each player in each game.

At minimum:

- `game_id`
- `player_id`
- `control_id`
- `control_type`
- relevant control configuration
- assignment timestamp, if useful
- assignment / configuration version, if applicable

The data must allow us to reconstruct which player was responsible for which control during a particular game.

---

## 3. Instruction lifecycle

Introduce a reliable representation of an instruction as a game object or equivalent record.

An instruction must have a stable unique ID.

At minimum, record:

- `instruction_id`
- `game_id`
- sequence number, if applicable
- source player ID
- target player ID
- target control ID
- instruction type
- instruction payload / required action
- creation time
- successful transmission time
- execution start time, if applicable
- execution completion time, if applicable
- execution deadline
- final status

Use the actual existing instruction structure and naming conventions where possible.

The instruction record must distinguish:

- created
- transmitted successfully
- executed successfully
- executed incorrectly
- expired / deadline exceeded
- cancelled
- invalid / rejected

Only add states that are meaningful in the existing engine.

Do not create artificial events that do not correspond to actual game behavior.

---

## 4. Transmission telemetry

Record:

- who transmitted the instruction
- which instruction was transmitted
- target player
- target control
- when transmission started, if available
- when transmission was accepted as successful
- transmission duration
- whether transmission succeeded
- failure reason, if transmission failed

Define clearly what “successfully transmitted” means based on the actual game mechanics.

Do not assume that a message being typed, displayed, or sent from the browser automatically means the game accepted it.

If the game uses voice recognition, speech recognition, or another input mechanism, preserve the distinction between:

- player input
- recognized instruction
- instruction accepted by the game engine

Use the existing architecture to determine which events are observable.

---

## 5. Execution telemetry

For each instruction assigned to a player, record:

- target player
- target control
- required action
- actual action
- execution start time
- execution completion time
- execution duration
- deadline
- success / failure
- failure reason

The telemetry must allow us to answer:

- How many instructions did each player successfully execute?
- How many instructions did each player fail to execute?
- How long did successful executions take?
- Which controls produce the most failures?
- Which instruction types are difficult?
- How often are failures caused by expired deadlines?
- How often are failures caused by incorrect actions?

Do not conflate transmission time with execution time.

If the existing engine does not distinguish these stages, introduce the smallest appropriate internal representation to make the distinction reliable.

---

## 6. Timing rules

Use the existing game timing model.

Clearly distinguish:

- game time
- real timestamps
- instruction deadline
- transmission duration
- execution duration

If the game uses pauses, ticks, or a simulation clock, account for that correctly.

Do not introduce timing behavior that changes gameplay.

Use a consistent unit, preferably milliseconds internally.

Make sure the timing implementation is deterministic and testable where possible.

---

## 7. Lives and crash causality

Whenever an instruction failure affects lives, record:

- lives before the failure
- lives after the failure
- life cost
- failure reason
- instruction ID
- player responsible for the instruction
- target player
- target control

When the game crashes, record a crash event containing:

- `game_id`
- crash timestamp
- crash reason
- `caused_by_instruction_id`, if applicable
- responsible player ID, if applicable
- target player ID, if applicable
- target control ID, if applicable
- relevant game state

The crash scoreboard must identify the actual instruction that caused the transition to the crashed state.

Do not infer the responsible player simply as “the player with the most failures.”

Do not label a player as the cause of the crash if the game did not establish that their instruction caused the final life loss.

---

## 8. Debugging information

Add sufficient context to debug failed games.

At minimum, preserve:

- game ID
- level ID
- level / engine version if available
- instruction ID
- player IDs
- control ID
- required action
- actual action
- deadline
- status
- failure reason
- relevant lives state

If the project has an existing logging or error reporting system, integrate with it rather than creating a competing system.

Avoid logging secrets or unnecessary personal data.

---

# Feature 2 — Crash scoreboard

## Goal

Display player performance on the existing crash / game-over screen.

Do not redesign the screen. Integrate the statistics into the existing UI structure and visual system.

The scoreboard must use the telemetry / game result data generated by the engine.

---

## Required player metrics

For each player, display:

1. Number of instructions successfully transmitted.
2. Number of instructions successfully executed.
3. Number of failed instructions, if meaningful.
4. Average execution time for successful executions, if meaningful.
5. Whether the player caused the crash.

Use clear labels.

Do not introduce a single composite “best player” score unless the existing game already has one and the task explicitly requires it.

Do not rank or label players as best / worst based on arbitrary assumptions.

Preserve the distinction between:

- communication contribution
- execution contribution
- failures
- crash causality

If the game has a concept of transmission attempts, use it to calculate transmission success rate. Otherwise do not fabricate a denominator.

If there are no successful executions for a player, handle average execution time safely and display an appropriate empty value.

---

## Crash cause display

Display:

- crash reason
- responsible instruction
- responsible player
- target player
- target control
- relevant failure details
- time / deadline information where useful

Use existing game terminology.

Do not expose internal debug identifiers to players unless appropriate for the existing product.

---

# Data and architecture requirements

## Source of truth

The game engine owns the truth about:

- instruction acceptance
- instruction execution
- life reduction
- crash transition
- player/control assignment

Telemetry should observe and record these events at the appropriate engine boundaries.

Do not reconstruct game outcomes from UI state.

Do not duplicate life-loss or crash logic in the scoreboard.

## Persistence

Inspect the existing project and determine the appropriate storage mechanism.

The implementation should support future analysis and balancing.

If telemetry is currently only stored in memory, design it so that adding persistence or exporting later is straightforward.

Do not build a full analytics backend unless required by the current architecture.

If a local export mechanism is useful and small, consider it, but do not expand scope unnecessarily.

---

# Testing requirements

Add or update tests for the following scenarios:

1. An instruction is created and receives a unique ID.
2. An instruction is successfully transmitted.
3. An instruction is not successfully transmitted.
4. An instruction is successfully executed.
5. An instruction is executed incorrectly.
6. An instruction expires.
7. Execution duration is recorded correctly.
8. Transmission duration is recorded separately from execution duration.
9. Lives are reduced correctly after a failure.
10. The correct instruction is identified as the crash cause.
11. The correct player is identified as responsible for the crash.
12. A game ending in victory does not incorrectly report a crash.
13. A player with no successful executions does not produce an invalid average.
14. A player disconnecting does not automatically receive an incorrect failure attribution.
15. The scoreboard displays the correct values from telemetry.
16. Existing gameplay behavior remains unchanged.

Use the project's existing testing framework.

Do not remove or weaken existing tests.

---

# Important constraints

- This is an engine / telemetry implementation task, not a design exploration task.
- Do not change the approved retro-space industrial control-panel direction.
- Do not introduce unrelated mechanics.
- Do not rewrite working systems without a clear reason.
- Do not create a separate scoreboard calculation system.
- Do not assume a backend, database, or framework without inspecting the repository.
- Do not silently change game rules or timing.
- Do not hide uncertainty in the implementation: if an event cannot be reliably observed, document that limitation.
- Do not add arbitrary player rankings or composite scores.
- Keep the implementation modular and extensible for future balancing analytics.

---

# Deliverables

1. Implemented telemetry system.
2. Implemented crash scoreboard.
3. Data model / event schema documentation.
4. Tests covering the required scenarios.
5. Short summary of changed files and architecture.
6. Any assumptions or limitations.
7. Instructions for inspecting or exporting telemetry for future analysis.

Before finishing, run the existing test suite and relevant new tests.

Report any failures clearly.

The implementation is complete only when the game still behaves correctly and the telemetry accurately reflects the actual game events.