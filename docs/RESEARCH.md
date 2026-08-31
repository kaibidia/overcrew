# RESEARCH.md — Overcrew

Prior art review for a browser-based, mobile-first, server-authoritative
cooperative shouting game (Spaceteam family).

Keep this short. It exists so future sessions do not re-research from scratch.

---

## Projects reviewed

| Project | Stack | Relevance |
|---|---|---|
| **OpenSpaceTeam backend** (`openspaceteam/backend`) | Python 3.6, asyncio, `python-socketio`, aiohttp | Closest match: full Spaceteam clone, server-authoritative, event-driven, in-memory rooms |
| **OpenSpaceTeam frontend** (`openspaceteam/frontend`) | Vue 2, `socket.io-client` 2, Vuex, vue-router | Scene flow (Start → Host/Join → Lobby → Game), control widgets, audio bus |
| **"Cloning Spaceteam"** (James Fisher, 2017) | Pusher pub/sub, later WebRTC | Communication-model thought experiment; a catalogue of what *not* to do |
| **Colyseus** (`colyseus/colyseus`) | Node/Bun, TypeScript, WebSocket, binary schema deltas | Modern authoritative-room framework; room lifecycle, matchmaking, reconnection |
| **boardgame.io** (`boardgameio/boardgame.io`) | Node, TypeScript, socket.io transport, immer | Modern authoritative model: reducer-style moves, secret-state stripping, match lobby, credentials |

---

## OpenSpaceTeam — how it actually works

Read directly from source. This is the most useful reference; details matter.

### Connection / identity
- `connect`: server creates a `Client(sid)`, assigns an incrementing `uid`, emits `welcome {uid}`.
- Identity is the raw Socket.IO `sid`. **No token, no persistent player id.**
- `disconnect`: client is disposed immediately.

### Rooms / lobby
- `LobbyManager` singleton holds `games_by_uuid` (in-memory dict).
- Room id is a **`uuid4` string** — not a human-friendly code. Private games are shared by pasting the UUID; public games appear in a lobby list pushed over a `"lobby"` socket room.
- Each Socket.IO room is `"game/{uuid}"`.
- `Game` has `slots: [Slot]`, `max_players` (2–4), `playing`, `health`, `level`, `difficulty` dict.
- First joiner becomes host; if host leaves in lobby, a random remaining slot is promoted.

### Client → server events
`create_game {name, public}`, `join_lobby`, `leave_lobby`, `join_game {game_id}`,
`change_game_settings {size?, public?}` (host only), `ready`, `leave_game`,
`start_game` (host only), `intro_done`, `command {name, value?}`,
`defeat_asteroid`, `defeat_black_hole`.

### Server → client events
`welcome {uid}`, `lobby_info`, `lobby_disposed`, `game_info {slots,...}`,
`game_join_success {game_id}`, `game_join_fail {message}`, `game_started`,
`grid` (per-client panel), `command {text, time, expired?}` (per-client instruction),
`health_info {health, death_limit}`, `next_level {level, modifier, text}`,
`game_over`, `player_disconnected`, `flip_grid`, `safe`.

### Panels ("grids")
- `Grid` runs a 4×4 layout-packing algorithm: it picks cell shapes (square, rectangles,
  big square), then picks a widget type from a shape-dependent pool
  (`Button`, `Switch`, `Slider`, `CircularSlider`, `ButtonsSlider`, `Actions`).
- **Widget mechanic, visual size, and name are decided together in one pass.**
- Names: generated from Italian word lists (`generate_noun_adjective` / compound noun),
  deduplicated within a panel only.
- **No cross-player complexity balancing.** Panels just fill a grid.

### Instructions
- Per slot, one active `Instruction(source, target, target_command)`.
- Targeting: `1/6` chance the instruction targets the recipient's own panel, otherwise a
  random *other* slot. So recipient ≠ owner is the common case but self-targeting exists.
- Command chosen randomly from the target panel's widgets, rejecting any widget already
  referenced by another active instruction and rejecting the immediately previous one.
- `expectedValue`: buttons → none; slider-likes → random new value in range ≠ current;
  switch → the opposite of current; actions → random action.
- `text`: random template with the control **name interpolated in** ("Impostare {name} a {value}").
- Each instruction is an `asyncio` task with an `instructions_time` timeout; expiry drains
  health and immediately regenerates.

### Validation
- `do_command(client, name, value)`: look up widget on *this client's* panel, type/range
  check the value, apply it to widget state, then scan **all active instructions** for one
  whose `target_command.name == name and value == expectedValue`. If found → complete it,
  bump health, regen the source slot's instruction. If not → silent no-op.
- Fully server-authoritative. Client only sends intent.

### Difficulty
- Per level: shorter instruction time (floor 7s), faster health drain, rising "death limit"
  (a floor that chases current health), plus random "game modifiers" (mirror grid,
  symbol names, asteroid/black-hole fields).
- Health-drain loop runs every 2s — the only periodic loop. Everything else is event / task driven.

### Disconnect handling — **the main weakness**
- Any disconnect *during play* emits `player_disconnected` and **disposes the entire game**.
- No grace period, no reconnect, no state resume. A dropped phone kills everyone's session.

---

## "Cloning Spaceteam" (James Fisher)

- Pub/sub over Pusher: one global channel + one channel per game.
- Player states: `IN_WAITING_ROOM → IN_GAME → GAME_FINISHED`.
- **Client-authoritative**: each client tracks its own success/failure counts, computes team
  health locally, and any client may publish `game over`. Instructions are generated on the
  client from its knowledge of everyone's dashboard.
- Difficulty curve: timeout `= 30 / log(buttonPresses)` seconds.
- Explicitly a stepping stone toward WebRTC P2P.

**Takeaway:** useful for the state-machine vocabulary and the difficulty-curve idea. The
authority model is the opposite of what we want — do not copy it.

---

## Colyseus

- **Room** = isolated server-side game instance. Lifecycle hooks: `onCreate`, `onJoin`,
  `onLeave`, `onDispose`.
- Server defines state as a schema; clients receive **binary delta patches** automatically.
- Authoritative: all logic server-side, clients send typed messages that the server validates.
- Built-in matchmaking (join-or-create, room ids, private/public, lobby room).
- Built-in reconnection: `allowReconnection(client, seconds)` keeps a seat open after a drop.
- Transport: WebSocket (ws / uWebSockets.js), Node or Bun.

**Takeaway:** the room-lifecycle shape and `allowReconnection` grace-period pattern are
exactly what Overcrew needs. We do not need Colyseus itself or binary schema sync — our
traffic is low-frequency events, and plain JSON over Socket.IO is simpler to debug.

---

## boardgame.io

- Game = pure reducer: `moves` are functions `(G, ctx) => void` (immer), no side effects,
  `G` must be JSON-serializable.
- Server is authoritative; clients dispatch moves, server re-runs them and broadcasts new state.
- **Secret state**: `playerView` / `PlayerView.STRIP_SECRETS` filters state per player before
  it leaves the server. Directly relevant — Overcrew players must not see other players'
  full panels or others' instruction internals.
- Match management: REST lobby API, `matchID`, per-player `credentials` token stored client-side.
- Multiplayer transport: `SocketIO()`; reconnection handled by socket.io plus a full `sync`
  on connect.

**Takeaway:** adopt (a) per-player state filtering on the server, (b) a persistent
`playerId` + `credentials` token so a reconnecting phone re-claims its seat, (c) "send full
snapshot on (re)connect, deltas afterwards". We do not need the reducer framework.

---

## Useful architecture patterns (adopt)

1. **Server-authoritative, event-driven.** One 1 Hz-ish timer for deadlines; no game loop.
2. **In-memory `Map<roomCode, Room>`.** Restart loses rooms — acceptable for MVP.
3. **Room lifecycle hooks** (create / join / leave / dispose) as in Colyseus.
4. **Grace-period reconnection**: mark player `disconnected`, keep the seat ~60 s, let them
   resume with a stored token. (Colyseus `allowReconnection`, boardgame.io credentials.)
5. **Per-player state filtering** before broadcast (boardgame.io `playerView`).
6. **Instruction text carries the control name**, generated from templates — like
   OpenSpaceTeam, and required by Overcrew's core invariant.
7. **Instruction target chosen independently of control owner**, with a self-target minority.
8. **Validation = apply intent to control, then scan active instructions for a match.**
9. **Full snapshot on connect, events after.**
10. **Seeded RNG** for panel/instruction generation so bugs reproduce.

## Patterns to avoid

1. **UUID room ids** (OpenSpaceTeam) — use a short, unambiguous, shout-friendly code.
2. **Killing the game on any disconnect** (OpenSpaceTeam) — the single biggest flaw.
3. **Identity = socket id** — breaks on every reconnect. Use a persistent player id + token.
4. **Client-authoritative scoring / instruction generation** (James Fisher).
5. **Coupling widget mechanic + visual size + name in one generation pass** (OpenSpaceTeam
   `Grid`). Keep control *definition*, *instance*, and *layout* separate (Overcrew §14).
6. **Binary schema sync / high-frequency state replication** (Colyseus default) — unneeded
   for event-paced play, harder to inspect.
7. **Grid-packing layout engine** on the server — let the client stack 4–6 controls
   vertically; the server only needs the logical list.
8. **Reducer/framework lock-in** (boardgame.io) — our state transitions are few and explicit.
9. Old dependency stacks (Vue 2 / socket.io 2 / webpack 3 in the reference frontend).

---

## Implications for Overcrew

- The OpenSpaceTeam model is ~80% right. The delta we must build: friendly room codes,
  persistent identity + reconnection, per-player state filtering, cross-player panel
  balancing, and clean separation of control definition / instance / layout.
- Nothing found argues against the proposed TypeScript + React + Node + Socket.IO stack.
- No project here does cross-player difficulty balancing well; that is original work
  (Overcrew §7) and belongs in `packages/shared` as pure, seeded, unit-tested functions.
- Reconnection is cheap to design in now and expensive to retrofit — pull a minimal version
  forward into Stage 2 (see roadmap note in `ARCHITECTURE.md`).

---

## Links

- OpenSpaceTeam backend — https://github.com/openspaceteam/backend
- OpenSpaceTeam frontend — https://github.com/openspaceteam/frontend
- "Cloning Spaceteam", James Fisher — https://jameshfisher.github.io/2017/01/30/cloning-spaceteam.html
- Colyseus — https://github.com/colyseus/colyseus • https://docs.colyseus.io
- boardgame.io — https://github.com/boardgameio/boardgame.io • https://boardgame.io/documentation
