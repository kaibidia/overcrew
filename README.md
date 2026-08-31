# Overcrew

Mobile-first browser-based cooperative shouting party game.

See [`docs/`](docs/) for research, architecture, game model, and decisions.
See [`OVERCREW_CLAUDE_CODE_PROMPT.md`](OVERCREW_CLAUDE_CODE_PROMPT.md) for the brief.

## Status

**Stage 3 — first cross-player mechanic.** On start each player gets a small
generated panel and one instruction naming a control by its label — which may be
on someone else's phone. Shout it, the owner acts, the server validates and
issues the next instruction. Server-authoritative; per-player state (you only
ever receive your own panel and instructions). No timers, no health yet.

The Stage 1 control playground (full V1 control alphabet) is still reachable at
`/#playground`.

## Requirements

- Node.js ≥ 20 (`brew install node` or `nvm`)

## Develop

```bash
npm install
npm run dev        # runs the game server (:3001) and the web client (:5173)
npm test           # unit tests: shared game logic + server room logic (Vitest)
npm run typecheck  # tsc --noEmit across all workspaces
```

- On the Mac: open `http://localhost:5173`.
- On a phone (same Wi-Fi): open `http://<mac-lan-ip>:5173` — find the IP with
  `ipconfig getifaddr en0`. The client auto-connects to the game server at
  `http://<mac-lan-ip>:3001`.
- If macOS prompts about incoming connections for `node`, **Allow** it (the
  server listens on `:3001`, Vite on `:5173`). The router must not have AP /
  client isolation enabled.

Individual workspaces: `npm run dev:server`, `npm run dev:web`.

## Layout

```text
apps/web          React + Vite client (playground + room/lobby)
apps/server       Node + Socket.IO room server (in-memory)
packages/shared   types, wire protocol, seeded RNG, control model, task model, room model, game model
docs/             RESEARCH / ARCHITECTURE / GAME_MODEL / DECISIONS
```
