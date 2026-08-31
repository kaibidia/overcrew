# CLAUDE.md — Overcrew

## Project

Overcrew is a mobile-first browser-based cooperative shouting party game.

Players join the same room from their phones and receive:

- a personal control panel;
- instructions referring to named controls.

Instructions and control ownership are independent.

An instruction may refer to a control owned by the same player or by another player.

The core gameplay loop is:

**read → search → shout → act → chaos**

The game UI and instructions are currently in Russian.

The working game title is **Overcrew**.

---

# Working principles

## 1. Repository is the source of truth

Before making assumptions about the project:

1. inspect the relevant files;
2. inspect existing types and architecture;
3. check `docs/`;
4. check recent decisions;
5. only then propose changes.

Do not invent components, APIs, events, files, or architecture that you have not verified exist.

If something is unclear, inspect the repository instead of guessing.

---

## 2. Read project documentation first

At the beginning of a substantial task, check the relevant documentation:

- `docs/ARCHITECTURE.md`
- `docs/GAME_MODEL.md`
- `docs/DECISIONS.md`
- `docs/RESEARCH.md`

Do not reread everything mechanically if the task is tiny.

Use documentation to avoid reconstructing decisions from scratch.

---

## 3. Work one stage at a time

Overcrew is intentionally developed as small, testable vertical slices.

Do not implement future roadmap stages unless explicitly requested.

If the current task belongs to Stage N:

**finish Stage N and stop.**

Do not add Stage N+1 features "while you're here."

Avoid speculative infrastructure.

---

## 4. Every stage must remain testable

After meaningful implementation work, the repository should be left in a runnable state.

For each stage provide:

### How to run

Exact commands.

### How to test

Concrete manual steps.

### Expected result

What should happen.

### Known limitations

What is intentionally not implemented yet.

Do not claim something works unless you have verified it as far as the available environment allows.

---

# Platform constraints

Overcrew V1 is a **browser game**.

It is not currently:

- a native iOS app;
- a native Android app;
- a WebView application.

Do not introduce:

- React Native;
- Capacitor;
- Swift;
- Kotlin;
- native app infrastructure;

unless explicitly requested.

The primary target is mobile Safari/Chrome in portrait orientation.

---

# Local multiplayer

Development must support local LAN testing.

Expected setup:

```text
Mac
 ├─ frontend
 └─ game server
       │
       │ local Wi-Fi
       │
 ├─ phone A
 ├─ phone B
 └─ phone C
```

Phones should be able to connect using the Mac's LAN IP.

Development servers should therefore be able to listen on:

`0.0.0.0`

Do not introduce external hosting merely to make development work.

Public deployment is a later concern.

---

# Architecture philosophy

Prefer the simplest architecture that supports the current gameplay.

Current intended direction:

- TypeScript;
- React frontend;
- Node.js backend;
- WebSockets / Socket.IO;
- shared protocol/types where useful;
- server-authoritative game state;
- in-memory rooms for MVP.

Do not introduce infrastructure without a demonstrated need.

Avoid premature use of:

- databases;
- Redis;
- Kafka;
- microservices;
- Kubernetes;
- event sourcing;
- complex state-management frameworks.

A single server process is fine for the MVP.

---

# Multiplayer rules

The server is authoritative for gameplay state.

Clients communicate player intent.

Examples:

```text
BUTTON_PRESSED
CONTROL_CHANGED
HOLD_STARTED
HOLD_ENDED
CONTROL_TAPPED
```

The server determines whether an instruction has been completed.

Do not trust the client to determine task success.

Avoid high-frequency synchronization unless a mechanic actually requires it.

Overcrew is primarily event-driven.

---

# Core game invariant

This rule is extremely important.

## Instruction recipient != control owner

These are independent concepts.

Example:

```text
Instruction:
ТУРБОЖАБА → 4

shownToPlayerId = player_A

Target control:
ТУРБОЖАБА

ownerPlayerId = player_B
```

This is valid.

This is also valid:

```text
shownToPlayerId = player_A
ownerPlayerId = player_A
```

Never encode a rule requiring them to be different.

Never encode a rule requiring them to be the same.

---

# Instructions

Every actionable instruction must explicitly contain the target control name.

Good:

```text
ТУРБОЖАБА → 4
```

Good:

```text
РЕАКТОР → ВКЛ
```

Good:

```text
УДЕРЖИВАТЬ КРИОСТАБИЛИЗАТОР
```

Bad:

```text
Установите значение 4
```

Bad:

```text
Включите свой переключатель
```

The player must be able to shout the instruction verbatim and allow another player to identify the corresponding control.

---

# UI terminology

Avoid wording that implies instruction ownership.

For example, avoid:

```text
ТВОЯ ЗАДАЧА
```

Prefer neutral wording such as:

```text
ИНСТРУКЦИИ
```

or:

```text
ВХОДЯЩИЕ ИНСТРУКЦИИ
```

---

# Controls

Keep these concepts separate:

1. control mechanic;
2. control visual representation;
3. control name;
4. instruction/task.

Do not tightly couple a sci-fi name to one specific mechanic unless necessary.

Example:

`ТУРБОЖАБА`

could theoretically be instantiated as a selector in one configuration without the engine treating "ТУРБОЖАБА" as a selector concept.

---

# Player panels

Normal player panels should contain approximately:

**4–6 controls**

depending on:

- control complexity;
- screen size;
- difficulty.

Do not fill a phone screen with 10+ tiny controls merely to increase difficulty.

Difficulty should mostly come from coordination pressure rather than bad usability.

---

# Randomization

Player control panels should differ.

Do not use unconstrained pure randomness.

Eventually balance panels using approximate complexity weights and balance instruction targeting across players.

Prefer deterministic or seeded behavior when it makes debugging easier.

When debugging random generation, make reproduction possible.

---

# Difficulty

Prefer increasing difficulty through:

- more concurrent instructions;
- overlapping deadlines;
- communication pressure;
- cooperative actions;
- critical events;

rather than making individual controls frustrating or excessively precise.

The bottleneck should become **team coordination bandwidth**.

---

# Mobile UI

Design mobile-first.

Primary orientation:

**portrait**

Prioritize:

- large touch targets;
- readable control names;
- strong hierarchy;
- clear active states;
- immediate interaction feedback.

Avoid tiny controls or desktop-style layouts squeezed onto mobile.

Visual polish must not reduce usability under time pressure.

---

# Visual direction

Current aesthetic direction:

- dark space environment;
- retro-futuristic spaceship hardware;
- industrial sci-fi;
- illuminated controls;
- playful absurdity;
- readable rather than photorealistic.

Do not over-polish visual design before the gameplay loop is proven.

---

# Scope discipline

Before implementing something, ask:

1. Is this required for the current stage?
2. Does an existing abstraction already solve it?
3. Can it be implemented more simply?
4. Can we test it immediately?

Prefer the smallest change that proves the mechanic.

---

# Code changes

Prefer:

- small coherent changes;
- existing patterns;
- simple types;
- explicit state transitions;
- testable pure game logic.

Avoid:

- giant refactors unrelated to the task;
- speculative abstractions;
- generic frameworks for hypothetical future mechanics;
- changing unrelated files;
- adding dependencies without justification.

If a larger refactor is genuinely necessary, explain why before doing it.

---

# Verification

Do not hallucinate success.

Before saying a task is complete:

- run relevant tests;
- run type checking;
- run linting if configured;
- build the affected application if practical;
- inspect errors;
- verify the changed path manually where possible.

If something cannot be verified in the current environment, state that explicitly.

Never silently treat an untested assumption as verified behavior.

---

# Tests

Prioritize automated tests for deterministic game-engine behavior.

Especially valuable:

- instruction generation;
- control assignment;
- instruction/control independence;
- target validation;
- balancing;
- timers/state transitions;
- synchronized actions;
- critical-event conditions.

Do not build an enormous E2E suite during early prototyping.

Real multi-phone manual testing remains important.

---

# Bugs

When debugging:

1. reproduce the problem;
2. identify the actual cause;
3. make the smallest appropriate fix;
4. verify the fix;
5. avoid unrelated cleanup.

Do not rewrite a subsystem simply because a local bug exists.

---

# Git safety

Do not:

- force push;
- rewrite history;
- delete branches;
- reset destructive changes;
- discard uncommitted user work;

unless explicitly requested.

Before destructive operations, inspect repository state.

Treat existing uncommitted changes as potentially intentional.

---

# Decisions

Record meaningful architectural or game-model decisions in:

`docs/DECISIONS.md`

Record decisions when they would otherwise be easy to forget or rediscover.

Do not record trivial implementation details.

Useful examples:

- why Socket.IO was chosen;
- room lifecycle decisions;
- reconnect semantics;
- how instruction targeting works;
- balancing rules;
- timer authority;
- critical-event semantics.

---

# Context discipline

Keep context focused.

Do not load the entire repository when only a few files matter.

Search first, then inspect relevant files.

Summarize findings rather than repeatedly rereading large files.

When a decision already exists in the repository, reuse it rather than re-deriving it.

---

# Communication style

Be concise and concrete.

When proposing architecture or implementation choices:

- explain the tradeoff;
- recommend one option;
- avoid presenting ten equivalent alternatives.

When something is uncertain, say so.

When repository evidence contradicts an assumption, trust the repository.

---

# Current priority

The project should progress in this order:

```text
research / architecture
        ↓
mobile controls
        ↓
LAN room + lobby
        ↓
first cross-player instruction
        ↓
randomized balanced panels
        ↓
timed game loop
        ↓
hold mechanics
        ↓
team tapping
        ↓
critical events
        ↓
game feel / polish
        ↓
public deployment
```

The core milestone is:

> Two phones are connected to the same room.  
> Phone A displays an instruction naming a control.  
> That control exists on Phone B.  
> Player A shouts it.  
> Player B performs the action.  
> The server validates it.  
> Both clients see the successful result.

Until that interaction feels good, avoid building unnecessary surrounding systems.