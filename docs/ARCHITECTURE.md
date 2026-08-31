# ARCHITECTURE.md — Overcrew

Status: Stages 0–2 implemented. `packages/shared` (control model, tasks, room
model), `apps/web` (Stage 1 playground at `#playground`, Stage 2 room/lobby
flow), `apps/server` (Socket.IO room server) all exist. Stage 3+ sections below
remain forward-looking; code is the authority once each lands.

---

## 1. Goals and non-goals

**Goals**
- Mobile browser game, joinable by opening a URL. Portrait, 4–6 controls per phone.
- 2–8 players, physically co-located, one room.
- Server-authoritative gameplay, event-driven, in-memory rooms.
- LAN development: Mac runs everything, phones connect over Wi-Fi via the Mac's LAN IP.
- Every stage ends in a browser-testable state.

**Non-goals (MVP)**
- No accounts, auth, database, Redis, message queue, or horizontal scaling.
- No native app, Capacitor, React Native, WebView.
- No public deployment until explicitly requested (Stage 10).
- No high-frequency netcode. This is not an action game.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | Shared types between client and server |
| Frontend | React 18 + Vite | Standard, fast dev server, trivial `--host 0.0.0.0` |
| Backend | Node.js (LTS) + TypeScript, `tsx` for dev | One process, minimal |
| Realtime | Socket.IO (server + `socket.io-client`) | Rooms, ack callbacks, auto-reconnect, easy to inspect; JSON not binary |
| Shared | `packages/shared` — types, protocol constants, pure game logic | Single source of truth; unit-testable without a browser |
| Tests | Vitest | Same runner for shared logic and (later) client |
| Package manager | npm workspaces | Built in; no extra global tool. (pnpm acceptable if preferred.) |

Rejected: Colyseus / boardgame.io (framework lock-in, sync model heavier than needed),
raw `ws` (lose rooms + reconnect + acks), any DB (rooms are ephemeral by design).

**Prerequisite:** Node is not currently installed on the dev machine. Install Node LTS
(via `nvm` or Homebrew) before Stage 1.

---

## 3. Repository layout

```text
overcrew/
  apps/
    web/                 React + Vite client
      src/
        controls/        one component per control mechanic
        screens/         Start, Join, Lobby, Game
        net/             socket client wrapper, reconnect/token handling
        state/           client-side view state
    server/              Node + Socket.IO
      src/
        index.ts         http + socket bootstrap, binds 0.0.0.0
        rooms/           RoomManager, Room, lifecycle
        game/            engine glue: wires shared logic to socket events
        net/             socket event handlers, per-player serialization
  packages/
    shared/
      src/
        protocol.ts      event names, payload types, PROTOCOL_VERSION
        model.ts         ControlDefinition, ControlInstance, Instruction, Player, RoomState
        rng.ts           seeded RNG
        panels.ts        panel generation + complexity balancing (pure)
        instructions.ts  instruction generation + target balancing (pure)
        validation.ts    "does this intent complete an instruction" (pure)
  docs/
```

`apps/web` and `apps/server` both depend on `packages/shared`.

---

## 4. Runtime topology (LAN dev)

```text
Mac
 ├─ Vite dev server      :5173   (--host 0.0.0.0)
 └─ Game server          :3001   (host 0.0.0.0, Socket.IO)
        ▲ local Wi-Fi
 ├─ phone A ─ http://<mac-lan-ip>:5173
 ├─ phone B ─ http://<mac-lan-ip>:5173
 └─ phone C ─ ...
```

- Client derives the socket URL from `window.location.hostname` + the server port, so the
  same build works from `localhost` and from a phone. Overridable via a Vite env var.
- Server enables CORS for the Vite origin in dev.
- **Production (Stage 10, later):** the server serves the built static client from the same
  origin, so there is one port and no CORS. The client's hostname-derivation already
  supports this.
- Prereqs to document per LAN stage: same Wi-Fi network, macOS firewall allows incoming
  connections for `node`, AP/client isolation disabled on the router.

---

## 5. Networking model

- **Server-authoritative.** Clients emit *intent*; the server owns all gameplay state and
  decides task completion. Never trust a client's claim of success.
- **Event-driven.** No per-frame loop. A single ~1 Hz timer (introduced in Stage 5) drives
  instruction deadlines and health. Stages 1–4 need no timer.
- **Snapshot then deltas.** On connect / reconnect the server sends one full,
  per-player-filtered snapshot; afterwards it sends targeted update events.
- **Per-player filtering.** Each player receives only: their own panel, their own
  instructions, and public room/ship state. Other players' panel internals and instruction
  internals never leave the server. (boardgame.io `playerView` pattern.)
- **Message envelope.** Every payload carries `PROTOCOL_VERSION`; on mismatch the client
  shows "refresh to update" rather than misbehaving.
- Client → server writes use Socket.IO **ack callbacks** so the UI can show accepted/rejected.

### Intent events (client → server), names finalized in `protocol.ts`
`ROOM_CREATE`, `ROOM_JOIN`, `ROOM_LEAVE`, `SET_READY`, `START_GAME` (host),
`CONTROL_CHANGED { controlId, value }`, `BUTTON_PRESSED { controlId }`,
`HOLD_STARTED / HOLD_ENDED { controlId }` (Stage 6), `CONTROL_TAPPED { controlId }` (Stage 7).

### State events (server → client)
`WELCOME { playerId, token }`, `ROOM_STATE` (lobby: players, host, codes),
`GAME_SNAPSHOT` (per-player), `PANEL` (per-player), `INSTRUCTIONS` (per-player),
`INSTRUCTION_RESULT { status }`, `SHIP_STATE` (Stage 5), `GAME_OVER`,
`PLAYER_CONNECTION { playerId, status }`, `ERROR { code, message }`.

---

## 6. Rooms and identity

### Room code
- 4 characters, uppercase, from a reduced alphabet excluding vowels and ambiguous glyphs
  (no `A E I O U`, no `0 1 I O`) → shout-friendly, low collision, no accidental words.
- `RoomManager: Map<code, Room>`. Collision → regenerate.
- Room disposed when empty (with a short delay) or on server restart.

### Player identity and reconnection  *(minimal version lands in Stage 2)*
- On first `connect` with no token, server issues `{ playerId (uuid), token }`; client
  stores both in `localStorage`.
- On reconnect the client presents the token. If a matching seat exists and is within the
  grace window, the player re-claims it; the server resends a fresh snapshot.
- On `disconnect`, the seat is marked `disconnected` and kept for **~60 s** (lobby: longer /
  indefinite). The game does **not** end. After the window, the seat is freed.
- During play, a `disconnected` player's instructions keep their deadlines (team still feels
  the pressure); design detail revisited at Stage 5.
- Socket id is transport-only and never used as identity.

### Host
- First joiner is host. If the host leaves the lobby, promote the earliest remaining player.
- Host-only actions: start game, room settings.

---

## 7. Game engine

- Thin server orchestrator around **pure functions in `packages/shared`**:
  - `generatePanels(players, seed) → ControlInstance[][]` with complexity weights (§7 of the
    master prompt) and roughly equal totals.
  - `generateInstruction(roomState, forPlayerId, seed) → Instruction`, target-owner chosen
    independently of `shownToPlayerId`, with target-distribution balancing.
  - `validateIntent(roomState, playerId, intent) → InstructionResult` — apply intent to the
    control instance, then scan active instructions for `controlId` + `expectedValue` match.
- The server holds authoritative `RoomState`; pure functions take it and return new
  state/values. Keep transitions explicit and logged.
- Seeded RNG (`rng.ts`) everywhere generation happens; the seed is logged per game so any
  session can be reproduced.

See `GAME_MODEL.md` for the data types and invariants.

---

## 8. Testing strategy

- **Automated (Vitest, `packages/shared`)**: panel generation, name uniqueness, complexity
  balance, instruction generation, target distribution, independence of
  `shownToPlayerId` / `ownerPlayerId`, intent validation, later hold/tap/critical conditions.
- **Manual (real phones on LAN)**: every stage. This is the primary confidence signal for
  networking and feel.
- No large E2E/browser-automation suite during prototyping.
- Each stage PR/commit includes: How to run · What changed · Manual test checklist ·
  Expected result · Known limitations.

---

## 9. Roadmap (deltas from the master prompt)

The master prompt's 10 stages stand. Adjustments:

1. ✅ **Stage 1 also defined the shared model.** Full control model + first task
   primitive (`SliderTask`) in `packages/shared`, control rendering only.
2. ✅ **Room codes from Stage 2** — 4 chars, no vowels / `0` / `1` (`shared/room.ts`).
3. ✅ **Reconnection in Stage 2.** Persistent `playerId` + secret token, 60 s grace
   window, `disconnected` seat state, room never destroyed by a drop
   (DECISIONS D32–D34). Lobby-scoped; mid-game resume detail revisited at Stage 5.
4. **Per-player state serialization from Stage 3**, the first time private state exists.
   Don't broadcast full room state and filter on the client. (Stage 2's `room:state`
   is fully public — that is fine, a lobby has no secrets.)
5. **Stages 6 and 7 share infrastructure** (server-side progress accumulator fed by
   repeated/continuous intent events). Build that abstraction once in Stage 6; Stage 7 is
   then mostly a new control + a shared counter. Keep the separate test checkpoints.
6. Everything else — including "no timers until Stage 5" — as written.

Unchanged core milestone: Phone A shows an instruction naming a control that lives on
Phone B; A shouts it; B acts; server validates; both see success. That is Stage 3.
