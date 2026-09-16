# Overcrew — Claude Code Master Prompt

## Objective

We are building a browser-based cooperative shouting party game called **Overcrew**.

Do **not** start by implementing the full game.

Your first job is to:

1. inspect the repository;
2. research relevant open-source implementations;
3. propose a minimal architecture;
4. create an incremental implementation plan;
5. then implement only **one testable stage at a time**.

The most important constraint is:

> After every implementation stage, there must be a working state that I can open in a browser, preferably on multiple physical phones, and manually test before we continue.

Do not jump ahead to later stages.

---

## 1. Game concept

Overcrew is inspired by games like Spaceteam.

Players are physically together in the same room. Each player opens the game in a mobile browser.

Players join the same room using a room code.

Each player sees:

- one or more instructions;
- their own randomly generated control panel;
- global game status.

### Critical mechanic: instructions and controls are independent

Instructions and controls are assigned independently.

An instruction can refer to:

- a control on the same player's screen;
- a control on another player's screen.

The player does **not** know beforehand who owns that control.

They have to:

1. look for the named control on their own screen;
2. if they do not have it, shout the instruction to the group;
3. another player finds that control and performs the action.

The exact control name **must always appear in the instruction**.

Example:

Instruction shown to Player A:

> ТУРБОЖАБА → 4

The control named `ТУРБОЖАБА` may belong to Player A, Player B, Player C, etc.

Do not show UI concepts such as "your task" that imply the corresponding control belongs to the instruction recipient.

---

## 2. Platform constraint

Overcrew V1 is a **mobile-first browser game**.

It is **not**:

- a native iOS app;
- a native Android app;
- a WebView wrapper.

Players should be able to join simply by opening a URL in Safari or Chrome.

### Local development

For MVP development and testing, the app must support **LAN-only local testing**:

- frontend and backend run on the developer Mac;
- mobile devices on the same Wi-Fi network can open the game using the Mac's local IP;
- no external hosting is required;
- no domain is required;
- no database is required;
- no App Store or TestFlight is required;
- no Capacitor, React Native, or native iOS project is required.

The development servers must be configurable to listen on `0.0.0.0`, not only `localhost`.

Every multiplayer stage must be manually testable using **2+ physical phones connected to the same Wi-Fi network as the development Mac**.

The architecture should leave an easy future path to:

1. deploy the same web app publicly;
2. make it installable as a PWA;
3. optionally wrap it with Capacitor later if native distribution becomes useful.

Do not introduce native infrastructure during MVP development unless explicitly requested.

---

## 3. Language and UI

Working title:

**OVERCREW**

The interface and all game instructions should initially be in **Russian**.

The game name stays English.

Primary orientation:

**portrait / vertical mobile screen**

A normal player screen should contain approximately **4–6 controls**, depending on control complexity and screen size.

Do not design around desktop first.

Desktop may show a centered phone-sized game area during development.

### Visual direction

- retro / industrial sci-fi;
- spaceship control panel;
- dark background;
- colored illuminated controls;
- space hardware / retro-futurism;
- readable under pressure;
- large touch targets;
- not overly decorative;
- control names must be visually prominent.

---

## 4. Atomic controls

Design the game engine so that control behavior and visual presentation are separate concepts where practical.

### Button

Example:

> НАЖАТЬ АВАРИЙНЫЙ СБРОС

Action: single tap.

### Toggle

States:

- ВКЛ
- ВЫКЛ

Example:

> РЕАКТОР → ВКЛ

### Direction selector

Values:

- ВВЕРХ
- ВНИЗ
- ВЛЕВО
- ВПРАВО

Example:

> ГИРОСКОП → ВЛЕВО

### Discrete selector

Examples:

- 1–5
- НИЗКИЙ / СРЕДНИЙ / ВЫСОКИЙ

Example:

> ТУРБОЖАБА → 4

### Slider / numeric value

Example range: 0–100.

Example:

> ДАВЛЕНИЕ → 70

For early prototypes, use discrete steps rather than requiring pixel-perfect values.

### Rotary knob

Several discrete positions around a dial.

Example:

> ЧАСТОТА КВАЗАРА → 6

### Hold control

The player must press and continue holding.

Example:

> УДЕРЖИВАТЬ КРИОСТАБИЛИЗАТОР

### Mash / repeated tap

Example:

> ПРОКАЧАТЬ ПЛАЗМОНАСОС × 12

Requires N taps.

### Later controls

Only after the basic engine works:

- button sequences;
- numeric keypad / codes;
- linked controls;
- simultaneous actions.

Do **not** implement all control types immediately.

---

## 5. Multiplayer mechanics

We need a central multiplayer game state.

For MVP assume roughly **2–8 players**.

Players:

- create a room;
- receive a short room code;
- join from separate phones;
- enter a nickname;
- appear in a lobby;
- host starts the match.

No accounts.

No authentication.

No database is necessary for the first version unless there is a compelling architectural reason.

Rooms may exist only in server memory.

If the server restarts and the room disappears, that is acceptable for the MVP.

---

## 6. Game state ownership

Prefer a **server-authoritative model**.

Clients should send player intent, for example:

- `CONTROL_CHANGED`
- `BUTTON_PRESSED`
- `HOLD_STARTED`
- `HOLD_ENDED`
- `CONTROL_TAPPED`

The server decides whether an action completes an instruction.

Do not let each client independently decide whether a task succeeded.

Avoid unnecessary high-frequency game loops.

This is not an action game. Most synchronization is event-based.

---

## 7. Random control assignment and balancing

Players must receive different random control panels.

Do **not** use pure random generation.

Each control type should eventually have a rough complexity weight.

For example:

| Control | Weight |
|---|---:|
| button | 1 |
| toggle | 1 |
| direction | 1 |
| selector | 1.5 |
| knob | 1.5 |
| slider | 2 |
| hold | 2 |

The generator should try to give players panels with roughly comparable total complexity.

Instruction targets should also be balanced so that one player does not receive almost all actions while another player does nothing.

The exact algorithm does not need to be sophisticated initially.

Start simple and deterministic enough to test.

---

## 8. Cooperative mechanics to support later

The architecture should make these possible, but do **not** build them all in the first stages.

### Synchronized hold

Two or more different controls must be held simultaneously.

Example:

- СТАБИЛИЗАТОР А
- СТАБИЛИЗАТОР Б

Both must be held for several seconds.

If one player releases early, progress stops or resets.

### Team mash

Several players contribute taps to a shared counter.

Example:

> АВАРИЙНАЯ ПРОКАЧКА: 0 / 40

All valid taps contribute to the same server-side total.

### Distributed mash

Different controls each have their own required tap count.

Example:

- НАСОС A: 10
- НАСОС Б: 10
- КОМПРЕССОР: 10

Players must identify who owns each one.

### Critical event

Every N minutes or according to game progression, a dangerous event can occur.

Example:

> КРИТИЧЕСКАЯ ПЕРЕГРУЗКА  
> 10 секунд

Failure should have a much bigger consequence than ordinary task failure and may cause instant game over.

A critical event may eventually combine several mechanics:

- two synchronized holds;
- slider target;
- shared tapping.

The architecture should support compound event conditions later.

---

## 9. Research before implementation

Before writing significant game code, research open-source projects relevant to this architecture.

At minimum inspect:

### OpenSpaceTeam

Backend:

https://github.com/openspaceteam/backend

Find and inspect its frontend repository as well.

Study:

- room/session structure;
- event protocol;
- player state;
- task generation;
- control assignment;
- synchronization;
- disconnect handling.

Do **not** blindly copy its architecture.

It is old code. Extract useful concepts.

### Cloning Spaceteam

https://jameshfisher.github.io/2017/01/30/cloning-spaceteam.html

Understand the multiplayer communication model and evaluate which ideas are still useful.

### Additional projects

Find at least **2 additional modern open-source browser multiplayer games** using:

- WebSockets or Socket.IO;
- room codes/lobbies;
- server-authoritative state;
- TypeScript if possible.

We care more about their multiplayer architecture than their gameplay.

For each useful project, record:

- stack;
- room model;
- connection model;
- state ownership;
- reconnect/disconnect approach;
- useful ideas;
- things we should **not** copy.

---

## 10. Research deliverable

Create:

`docs/RESEARCH.md`

Do not write a giant essay.

Include:

- Projects reviewed
- Useful architecture patterns
- Patterns to avoid
- Implications for Overcrew
- Recommended architecture
- Links to repositories/articles

---

## 11. Architecture preference

Unless repository constraints strongly suggest otherwise, prefer a simple TypeScript stack.

Candidate:

**Frontend**
- React
- TypeScript

**Backend**
- Node.js
- TypeScript

**Realtime**
- Socket.IO or a suitable WebSocket library

**Shared**
- shared TypeScript types/events

Keep dependencies minimal.

Do not introduce:

- Kubernetes;
- microservices;
- Redis;
- Kafka;
- database;
- event sourcing;
- complicated state management frameworks;

unless the project actually reaches a point where they are necessary.

For MVP, one process with rooms stored in memory is desirable.

Possible conceptual structure:

```text
apps/
  web/
  server/

packages/
  shared/

docs/
```

Inspect the existing repository before deciding.

---

## 12. Implementation philosophy

Build **vertical slices**, not horizontal infrastructure layers.

Bad:

```text
Stage 1 backend
Stage 2 protocol
Stage 3 frontend
Stage 4 UI
```

Nothing is playable until late.

Good:

```text
Stage 1: one browser renders controls and they feel good
Stage 2: two browsers join one room and see each other
Stage 3: an instruction on browser A can be completed using a control on browser B
```

Every stage must create something manually testable.

---

# 12a. Future game modes (architectural context — NOT current scope)

Overcrew is designed around one reusable core idea:

> A crew of players jointly operates one complex system through distributed
> physical controls, time pressure, and verbal coordination.

Genre / short description:

**shouting co-op game**

The first implementation stays focused on the current space-themed game. But do
**not** unnecessarily hard-code the core control/task architecture to a
spaceship — the same interaction system may later power other game modes.

There are currently exactly **three** top-level game-mode directions.

## 1. Space Disaster

The current primary mode and the one we build first.

Players are the crew of a malfunctioning spacecraft. Gameplay focuses on:

- incoming instructions;
- shouting control names and values;
- executing actions on controls owned by different players;
- simultaneous failures;
- emergency procedures;
- synchronized actions;
- keeping the ship operational under increasing pressure.

This is the implementation priority. **Do not delay it to support the modes
below.**

## 2. Restaurant Rush

*Future concept only. Do not implement now.*

Players collectively operate a restaurant kitchen during a busy service. Same
cooperative principles, but the challenge shifts toward:

- parallel processes;
- timing;
- coordinating preparation;
- starting actions at the correct moment;
- making multiple components finish at approximately the same time;
- handling several orders simultaneously.

Example — a dish requires:

```text
steak:   20 seconds
pasta:   12 seconds
sauce:    8 seconds
plating:  4 seconds
```

The goal is **not** to complete every action as fast as possible. Players must
coordinate **when** processes start so the complete dish reaches the pass
together. This introduces an important future cooperative pattern:

> Multiple independent processes must converge on the same completion window.

The same primitive controls — Button, Toggle, Direction, Shape Selector, Slider,
Dial, Hold, Mash — may be reused to represent kitchen equipment and actions.

## 3. Giant Mech Battle

*Future concept only. Do not implement now.*

A crew jointly operates one enormous combat machine. No individual player
controls the whole mech. Movement, weapons, defense, cooling, stabilization,
power and other systems are distributed across the crew.

High-level actions — `ATTACK`, `BLOCK`, `DODGE`, `ADVANCE`, `CHARGE`, `REPAIR` —
eventually translate into coordinated procedures over the existing control
primitives.

Example attack procedure:

```text
ГИРОСКОП → ВПРАВО
ДАВЛЕНИЕ → 74 ± 4
СТАБИЛИЗАТОР → УДЕРЖИВАТЬ
ИОННЫЙ ПУСКАТЕЛЬ → НАЖАТЬ
```

Completing the procedure makes the mech perform the corresponding action.

**Boss Battle** and **PvP** are **not** separate top-level modes — they are two
variants of Giant Mech Battle:

- **Boss Battle** — one crew cooperatively fights an AI-controlled giant enemy.
  Boss behavior creates incoming attacks, attack windows, defensive procedures,
  vulnerable phases, emergency repairs, temporary system failures. The crew
  alternates between operating the mech offensively and reacting to the boss.
- **PvP (team vs team)** — two crews control two opposing mechs (e.g. 4v4). One
  team's successful actions create situations the other team must react to
  (Team A prepares an attack → Team B gets an incoming-attack warning → Team B
  attempts a coordinated block/dodge → failure causes damage).

Damage should eventually be able to affect the **machine itself**, not only an HP
number — e.g. a slider slowly drifts, a toggle occasionally disengages, a Hold
takes longer, a weapon is temporarily unavailable, a subsystem must be repaired
before normal use. Combat can then make the mech *harder to operate*.

## Architecture guidance

These future modes are **context, not scope**.

- Do **not** build a generic mega-engine in advance.
- Do **not** introduce abstractions merely because a future mode might need them.
- Follow **YAGNI**.

However, when two implementation choices are equally simple, prefer the one that
does **not** unnecessarily assume:

- every game is about a spaceship;
- every task represents a malfunction;
- every successful task only repairs health;
- every control belongs to a specific spaceship subsystem.

The reusable core conceptually remains:

```text
CONTROL PRIMITIVES
        ↓
CONTROL INSTANCES
        ↓
TASKS / COOPERATIVE PROCEDURES
        ↓
GAME-MODE CONSEQUENCES
```

Space Disaster is simply the first consumer of this system.

## Deferred: Distributed Knowledge

Do **not** currently expand toward puzzle-heavy distributed-information
mechanics: one player seeing half a solution; combining clues to determine what
action is required; hidden rules known only to another player; communication
puzzles where the team must first deduce the solution. These may be explored
later as a different style of cooperative play.

For the current core experience, prioritize:

> We know what needs to be done, but coordinating everyone quickly enough is
> difficult.

rather than:

> We must first collectively figure out what needs to be done.

The desired current experience is **fast, physical, noisy, reactive**, and
suitable for a party game.

---

# 13. Staged implementation

Review this plan after research and modify it if necessary.

Do not implement beyond the current stage unless explicitly asked.

---

## Stage 0 — Repository + research + architecture

### Goal

Understand what we are building before adding game code.

### Deliverables

- inspect repo;
- `docs/RESEARCH.md`;
- `docs/ARCHITECTURE.md`;
- `docs/GAME_MODEL.md`;
- proposed folder structure;
- technology choice;
- development commands;
- staged roadmap.

### Testing

No gameplay required.

I should be able to read the docs and approve the architecture.

**STOP after this stage.**

---

## Stage 1 — Mobile UI playground

### Goal

Validate the physical controls on a phone before multiplayer.

Implement a local development page containing **4–6 controls**.

Initially include:

- button;
- toggle;
- direction;
- selector;
- slider;
- knob.

Use Russian placeholder sci-fi names.

Examples:

- ТУРБОЖАБА
- КРИОКЛАПАН
- ФАЗОВРАЩАТЕЛЬ
- ПЛАЗМОНАСОС

No multiplayer yet.

No game loop.

Focus on:

- portrait mobile layout;
- touch target size;
- responsiveness;
- readability;
- interaction feel.

### Testing checkpoint

I open the page on my physical phone over the local Wi-Fi network and manually test every control.

**STOP.**

---

## Stage 2 — Room and lobby

### Goal

Validate actual multi-device networking.

Implement:

- create room;
- room code;
- nickname;
- join room;
- player list;
- host indicator;
- start button.

No real game yet.

### Testing checkpoint

I open the site on 2–4 physical phones connected to the same Wi-Fi network as the development Mac.

One creates a room.

Others join using the code.

All devices see the same player list.

Disconnecting removes or marks the player appropriately.

No external hosting should be required.

**STOP.**

---

## Stage 3 — First real Overcrew mechanic

### Goal

Prove the fundamental game concept end-to-end.

When the game starts:

- each player receives a small set of controls;
- one instruction is generated;
- the instruction explicitly contains the target control name;
- instruction recipient and target-control owner are independently assigned;
- target control may belong to the same player or another player.

Example:

Player A sees:

> ТУРБОЖАБА → 4

Player B owns:

> ТУРБОЖАБА [1 2 3 4 5]

When Player B sets it to 4:

- server validates the action;
- instruction completes;
- relevant clients receive updated state;
- a new instruction appears.

Keep only simple controls initially:

- button;
- toggle;
- selector.

### Testing checkpoint

Two physical phones can complete tasks belonging to each other over the LAN.

This is the first actual playable prototype.

**STOP.**

---

## Stage 4 — Randomized panels and balancing

### Goal

Every player has a distinct 4–6 control panel.

Add:

- larger pool of control names;
- different control types;
- randomized assignment;
- basic complexity weights;
- target distribution balancing.

Add:

- direction;
- slider;
- knob.

### Testing checkpoint

Play several short sessions.

Verify:

- players get different panels;
- every named instruction corresponds to exactly one active control;
- instructions sometimes refer to your own controls;
- instructions sometimes refer to other players;
- no one player receives nearly all required actions.

**STOP.**

---

## Stage 5 — Timed game loop

### Goal

Turn the mechanic into an actual game session.

Add:

- task deadlines;
- failure;
- ship health;
- score/progress;
- game timer;
- game over;
- basic difficulty progression.

Difficulty should primarily grow through:

- more simultaneous instructions;
- shorter deadlines;
- increased overlap;

not through making individual controls annoying.

### Testing checkpoint

Play a complete 2–3 minute game from lobby to game over.

**STOP.**

---

## Stage 6 — Hold mechanics

Add:

- hold control;
- `HOLD_STARTED`;
- `HOLD_ENDED`;
- server-side hold state.

Then add synchronized hold:

two controls must be held simultaneously for N seconds.

### Testing checkpoint

Two physical phones must hold their controls at the same time.

Releasing one early must cancel, pause, or reset completion according to the selected rule.

**STOP.**

---

## Stage 7 — Team tapping

Add:

- mash controls;
- server-side tap count;
- shared progress.

Support:

- individual mash;
- team mash.

### Testing checkpoint

Two or more physical phones contribute simultaneously to a shared counter.

**STOP.**

---

## Stage 8 — Critical events

Add rare high-priority events.

Example:

> КРИТИЧЕСКАЯ ПЕРЕГРУЗКА  
> 10 секунд

A critical event can require multiple conditions.

Possible combination:

- two synchronized holds;
- slider at 70;
- 30 shared taps.

Failure may immediately end the game.

### Testing checkpoint

Play until at least one critical event occurs.

Verify both success and failure paths.

**STOP.**

---

## Stage 9 — Game feel

Only after the core game is demonstrably fun.

Add:

- sound;
- animations;
- screen shake;
- visual alarms;
- stronger failure/success feedback;
- transitions;
- improved retro-space / spaceship aesthetic.

Do not let visual polish block gameplay testing before this point.

---

## Stage 10 — Public deployment, only when requested

Local LAN testing is sufficient for development.

Do not deploy publicly until explicitly requested.

When we decide the game is ready to share outside the local network, propose the simplest low-cost deployment architecture.

The initial public deployment should ideally still require:

- one small application server;
- no database unless persistence has become necessary;
- minimal operational complexity.

---

# 13a. Telemetry & crash scoreboard (implemented ahead of schedule)

Real playtesting surfaced a concrete gap: nobody could tell who — or which
instruction — actually caused a crash. This was implemented immediately, out
of the staged order above, per a dedicated spec:
`docs/Overcrew — Game Telemetry & Crash Scoreboard.md`.

Treat this as already-built infrastructure when working on later stages
(Critical events, Game feel) — extend it, do not re-invent it.

## What exists

- An in-memory telemetry event log owned by `Game`
  (`apps/server/src/game.ts`), appended only at real state transitions:
  instruction created / transmitted / execution started / resolved, life
  lost, crash. No new subsystem, no persistence layer.
- A pure reducer, `buildScoreboard()` (`packages/shared/src/telemetry.ts`),
  turns that log into a `ScoreboardView`. The scoreboard is a **projection**
  of telemetry — there is no separate scoring logic that could drift from
  the actual game state.
- The scoreboard is attached to `PlayerView.scoreboard` once the game ends
  and rendered on the existing `GameOver` screen — no new screen, no
  redesign.

## Principles to keep whenever this is touched again

- **Source vs target, never conflated.** An instruction's *source* is
  whoever it is shown to (responsible for communicating it); its *target*
  is the owner of the control (responsible for acting on it). Communication
  contribution and execution contribution are tracked separately — the same
  independence rule as §1's "instructions and controls are independent."
- **No fabricated states.** Only terminal states the engine actually
  produces are recorded (`executed`, `expired`, `cancelled`). Do not invent
  an "executed incorrectly" or "won" outcome just because a generic
  telemetry spec expects one — `validateIntent` has no such state, and the
  game currently has no win condition.
- **Crash causality is exact, not inferred.** The instruction whose expiry
  actually brought health to zero is the cause — never "the player with the
  most failures." A structural game-over (crew too small) has no
  instruction to blame; leave it unattributed rather than guessing.
- **"Transmission" means socket delivery, not speech recognition.** Overcrew
  has no voice input — an instruction counts as transmitted once the server
  actually delivers it to a connected client.

---

# 14. Data model principles

Keep these concepts independent.

## Control definition

What interaction exists.

Example:

```text
type = selector
values = [1, 2, 3, 4, 5]
```

## Control instance

A named control belonging to one player.

Example:

```text
id = control_123
name = ТУРБОЖАБА
ownerPlayerId = player_B
type = selector
```

## Instruction

A desired state/action referencing a control.

Example:

```text
controlId = control_123
expectedValue = 4
shownToPlayerId = player_A
```

Critically:

`shownToPlayerId` and `control.ownerPlayerId` may be equal **or** different.

Do not encode an assumption that they must differ.

---

# 15. Testing philosophy

Prefer automated tests for game-engine rules.

Especially test:

- instruction generation;
- uniqueness of control names;
- target selection;
- balancing;
- task validation;
- synchronized hold conditions;
- critical event completion.

Do not overbuild browser E2E tests initially.

Manual multiplayer testing on actual phones is important.

For every implementation stage provide:

## How to run

Exact commands.

For LAN stages, include the exact URL/IP pattern I should open from my phones and any firewall/network prerequisites.

## What changed

Short summary.

## Manual test checklist

Precise steps I should perform.

## Expected result

What I should see.

## Known limitations

Anything intentionally deferred.

Then stop and wait for my feedback.

---

# 16. Documentation

Maintain:

- `docs/RESEARCH.md`
- `docs/ARCHITECTURE.md`
- `docs/GAME_MODEL.md`
- `docs/DECISIONS.md`

Keep them concise.

Record meaningful decisions so future Claude Code sessions do not need to reconstruct architecture from scratch.

---

# 17. First action

Start with **Stage 0 only**.

1. Inspect the repository.
2. Research the referenced projects and additional modern examples.
3. Create the research and architecture documents.
4. Review the proposed roadmap and suggest changes if research indicates a better approach.

Do **not** start implementing Stage 1 yet.

At the end, report:

1. what you found;
2. recommended stack;
3. proposed architecture;
4. any changes you recommend to the staged roadmap;
5. files created/changed;
6. the exact next prompt I should give you to begin Stage 1.

Then **STOP**.
