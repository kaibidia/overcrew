# Playtest log analysis — first real batch (2026-09-16 / 2026-09-17)

## ⚠️ How this document came to exist

The raw telemetry files this analysis was built from
(`apps/server/logs/*.json`, 9 real games — see below) were **accidentally
deleted** during cleanup after an unrelated smoke test (`rm -rf` on the whole
`logs/` directory instead of the one test file in it). They are not
recoverable — `logs/` is gitignored, so nothing was ever committed, and the
delete bypassed the Trash.

This document reconstructs the analysis from conversation history rather than
from the original files. Treat every number below as **remembered, not
recomputed** — solid enough to act on (several conclusions were independently
confirmed twice), but if a figure ever looks off against a fresh batch of
logs, trust the fresh data over this document.

The bugs this analysis found are independently verifiable in the codebase
regardless of the lost logs (see "Bugs found" below) — that part doesn't rely
on memory.

---

## Dataset

Two play sessions with friends, 9 completed games total, all ending in a
`"health"` crash (nobody left mid-game in any of the 9):

- **Room `5KX8`**, 4 players (Метеор, Нейтрон, Турборубик, диана) — 5 games,
  2026-09-16 ~19:33–19:45.
- **Room `ND6T`**, 3 players (Метеор, Гравитон, Bulba) — 4 games,
  2026-09-17 ~20:53–21:02.

In both rooms, player order in the list below is join order (Метеор created
both rooms, i.e. was always the host / first joiner).

### Per-game summary

| Game | Duration | Level | Progress | Instructions | Self-target % | Crash cause (responsible) |
|---|---:|---:|---:|---:|---:|---|
| 5KX8 19:33 | 106.1s | 6 | 31 | 61 | 18.0% | «УРОВЕНЬ ПЛАЗМЫ → 73 ± 3» — Метеор |
| 5KX8 19:35 | 84.1s | 5 | 22 | 43 | 9.3% | «ВЕРНЬЕР → 2» — диана |
| 5KX8 19:39 | 112.1s | 6 | 32 | 67 | 17.9% | «ПЛАЗМОРУБИЛЬНИК → ВЫКЛ» — Метеор |
| 5KX8 19:41 | 100.1s | 6 | 35 | 63 | 17.5% | «ТЯГА РЕАКТОРА → 45 ± 2» — Метеор |
| 5KX8 19:45 | 115.1s | 6 | 39 | 70 | 22.9% | «КАЛИБРАТОР → 10» — Нейтрон |
| ND6T 20:53 | 121.2s | 7 | 41 | 66 | 22.7% | (not recorded) — Bulba |
| ND6T 20:57 | 112.2s | 6 | 36 | 58 | 17.2% | (not recorded) — Метеор |
| ND6T 21:00 | 121.2s | 7 | 38 | 60 | 21.7% | (not recorded) — Bulba |
| ND6T 21:02 | 116.2s | 6 | 38 | 61 | 24.6% | (not recorded) — Гравитон |

**Self-target rate** (instruction's recipient happens to own the target
control) across all 9 games: **107 / 549 ≈ 19.5%** — matches the
`SELF_TARGET_CHANCE = 0.2` constant in `packages/shared/src/game.ts` closely;
the mechanic behaves as designed.

**Crash responsibility** (which player owned the control behind the final,
health-zeroing expiry) across all 9: **Метеор 4, Bulba 2, диана 1, Нейтрон 1,
Гравитон 1.** Метеор — the host / first joiner in both rooms — caused the
crash in 4/9 games (44%), well above the ~1-in-N a random distribution would
suggest. This lines up with the panel-generation bug below: Метеор held a
`hold` control (the heaviest single-instruction type, and the one that
requires continuous attention through the end-game "avalanche", see below)
in literally every one of the 9 games.

### Panel complexity (5KX8 games only — the detail was captured for these 5)

All four players landed in a tight 14–19 band (target ≈ 15) in every game —
the complexity balancer works as intended:

| Game | Метеор | Нейтрон | Турборубик | диана |
|---|---:|---:|---:|---:|
| 19:33 | 16 | 16 | 16 | 18 |
| 19:35 | 16 | 18 | 15 | 16 |
| 19:39 | 19 | 16 | 17 | 15 |
| 19:41 | 16 | 18 | 14 | 16 |
| 19:45 | 17 | 18 | 18 | 18 |

### Instruction workload (instructions targeting each player as control owner, 5KX8 only)

More variance here (single-game range roughly 8–21), but no consistent
per-player skew across the 5 games — unlike the crash-cause and hold-control
findings, this looked like normal run-to-run variance rather than a bug.

---

## Bugs found (independently verifiable in code, not log-dependent)

### 1. Panel generator handed the `hold` control to whoever joined first

The clearest, most reproducible finding. Confirmed **twice** on two
independent friend groups: Метеор had a `hold` control in all 5 `5KX8` games;
in `ND6T`, Метеор *and* Гравитон (1st and 2nd joiners) had one in all 4
games, Bulba (3rd/last joiner) in none.

Simulated `generatePanels` 2000× with 4 players to confirm it wasn't
coincidence — **has-hold rate by join position**:

| Join position | Before fix | After fix |
|---|---:|---:|
| 1st | 93.3% | ~50.5% |
| 2nd | 83.3% | ~50.6% |
| 3rd | 14.8% | ~49.0% |
| 4th | 8.8% | ~49.8% |

**Root cause**: the "ensure ≥ 2 hold owners" top-up in `generatePanels`
(`packages/shared/src/game.ts`) picked `fresh.sort(...)[0]` to decide which
control to convert to `hold`. `Array.prototype.sort` is stable, and `fresh`
is built from `controls` in player-join order — so ties in the
complexity-distance score were silently broken by seat order every time,
not randomly.

**Fix** (already applied, see `DECISIONS.md` D72): shuffle `fresh` with the
seeded RNG before sorting. Re-simulation post-fix: ~50% for every join
position, matching the "≥ 2 of N" guarantee's expected random distribution.
A regression test (`packages/shared/src/game.test.ts`) asserts every
position lands in [30%, 70%] over 300 seeded games.

### 2. No overlapping/duplicate active instructions (verified, not a bug — noted for completeness)

Checked all instruction pairs active at the same time within the 5KX8 batch
(1788 overlapping pairs, including each `syncHold`'s second control, not just
its primary one — the first pass missed the second control and had to be
redone): **zero** cases of two active instructions sharing a target control,
and zero cases of identical instruction text active simultaneously. This is
guaranteed by `nextInstruction`'s `blocked` set (which includes a syncHold's
`withControlId`), and the data confirms it holds in practice. Also zero
`cancelled` instructions across all 9 games (nobody disconnected mid-game in
this batch, so that code path wasn't exercised).

---

## Mechanics notes validated against the real data

- **Difficulty ramp** is purely time-based: `level = 1 + floor(elapsedMs /
  20_000)`; `deadlineMs = max(6000, 22000 - (level-1)*2000)`;
  `instructionsPerPlayer` is 1 below level 3, 2 from level 3–5, 3 from level
  6 on; `expirePenalty = 6 + level`. The observed health-loss values in the
  logs (e.g. -8 around level 2, climbing to -12 by level 6) matched this
  formula exactly in every game checked.
- **"Avalanche" ending pattern**: every one of the 9 games ended not with a
  gradual decline but a burst of several instructions expiring in the *same*
  server tick in the last ~10–15 seconds (observed independently in at least
  4 of the 5 `5KX8` games, around a shared ~58s mark and again right at the
  death). Mechanically self-reinforcing: when several instructions expire
  together, they're replaced together with the same fresh deadline, so they
  tend to cluster and expire together again. Worth keeping in mind for any
  future difficulty-curve tuning.
- **`progress`** (crew-wide "tasks completed" counter) increments once per
  successful `completeInstruction()`, regardless of who performed it —
  it's a team total, separate from the per-player `executed` stat on the
  post-game scoreboard.

## Open design questions raised, not yet decided

Two balance discussions came out of this analysis that are **not**
implemented — flagging so they aren't lost along with the logs:

1. **Should finishing early bank leftover time onto the next instruction?**
   Currently a completed/expired instruction is immediately replaced with a
   fresh full-length deadline — a fast team just cycles through more
   instructions, with no "breather" reward. Options discussed: capped
   time-carryover, a small fixed pause, converting the reward into extra
   healing instead of time, or leaving it as-is (current choice — throughput
   itself is the reward, as in Spaceteam-likes).
2. **Should `level` (difficulty) scale with completed instructions instead
   of elapsed time?** Raised because it seemed inconsistent with "more
   instructions = the reward." Caution found: a naive switch creates a
   feedback loop (higher level → shorter deadlines/more concurrent
   instructions → faster completions → even higher level) that could make
   strong teams crash *sooner* in real time, not later — the opposite of the
   intended effect. A safer middle ground floated: `level = max(time-based,
   completion-based)`, which never speeds up pacing below today's baseline
   but lets unusually fast teams ramp ahead of schedule.
