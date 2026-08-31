# PANEL_LAYOUT.md — gameplay panel layout

The active gameplay screen is a non-scrolling instrument panel. This documents
the layout rules. It is *layout only* — final cockpit art is a later stage.

## Hard rule: no vertical scroll during gameplay

The instruction strip and the **complete** control panel must be visible at once
on one phone, without scrolling. A player hears "КАЛИБРАТОР НА 7!" and scans the
whole panel — scrolling to find a control is friction, not difficulty.

- `body.no-scroll` is set while `GameScreen` is mounted.
- `.room--game` / `.game` are `height: 100dvh; overflow: hidden` (dynamic
  viewport unit, not `100vh`), with `env(safe-area-inset-*)` padding.
- The panel grid has an **exact row count**; the area is split into that many
  equal tracks, so nothing overflows.

## Minimum supported gameplay viewport

**≈ 360 × 620 CSS px of usable height** (iPhone SE class, portrait, browser
chrome already subtracted). Layouts of 4–6 controls + the instruction strip must
fit there. Verified at 375 × 620 and 414 × 760.

## The lattice

A **4-column** grid. `apps/web/src/game/layout.ts` (`chooseLayout`):

1. builds a **base footprint** per control;
2. generates a handful of **candidate footprint sets** — taller vertical sliders
   (`2×3`, `2×4`), all-horizontal sliders, a `2×2` "feature" button, a promoted
   trailing small;
3. **first-fits** each candidate top-to-bottom / left-to-right (the way you'd
   tile a panel by hand — *not* a bin-packer);
4. **scores** them: reject if anything is unplaced or `rows > 6`; otherwise
   `−deadCells·8 − rows·1.5 + longSliderBonus + featureBonus + footprintVariety`;
5. keeps the best, then runs `fillHoles`: any `2×1` small (Button/Toggle/Hold/
   Mash) directly above an empty cell **grows down** into it, so an adjacent
   control uses the space a fixed grid would waste.

The result has an exact `rows` count; the panel area is split into that many
equal tracks and never scrolls. Some negative space around a control is fine —
large empty cells while an expandable Slider/Button could fill them are not.

`ControlType` and layout are separate — the same mechanic takes different
footprints:

| Control | Footprint(s) on the 4-col lattice | Notes |
|---|---|---|
| **button** | `2×1`, or `2×2` "feature", or `4×1`, or grown by `fillHoles` | a **round physical push button** — no counter, no "НАЖАТЬ" text; the housing/footprint varies, the round cap stays round and scales (never distorted into a rectangle) |
| **toggle** | `2×1` (also `4×1` when promoted) | compact horizontal switch, ≥ 46px tall |
| **hold** | `2×1` (feature `2×2`), or grown by `fillHoles` | button-like with bottom-up progress fill; distinct from the round Button |
| **mash** | `2×1`, or grown by `fillHoles` | rectangular, keeps its **`N / 12` counter** + progress fill — deliberately unlike the round Button |
| **direction** | `2×2` | cross needs ~square; rendered as the largest square that fits the cell |
| **shapeSelector** | `4×1` | all four `● ▲ ■ ◆` visible, ≥ 40px tap targets, no dropdown |
| **dial** | `2×2` | rotary needs area; largest square that fits, ticks scale with `cqmin` |
| **slider** | `4×1` horizontal **or** `2×2` … `2×4` vertical | orientation & length are layout choices; identical 0–100/step-1 + tolerance behaviour. When a vertical slider is given more rows the **track itself** grows (longer travel = more precision), not just its housing |

### Slider orientation

`chooseLayout` makes a slider **vertical (2×2)** when the panel already spends its
width on a `shapeSelector`, has ≥ 1 square control, or it is the panel's second
slider; otherwise **horizontal (4×1)**. Both:

- keep 0–100, step 1, and target/tolerance validation;
- show the current value prominently (large number above the track);
- give real travel distance (never shrunk to fill leftover space);
- work with touch (pointer capture, `touch-action: none`).

The accepted tolerance band is never drawn on the acting player's slider (D29).

### Variety

- Odd number of `2×1` controls → the last one is promoted to `4×1` (reads as
  emphasis).
- A panel with no square-ish control and ≤ 5 controls → one button/hold becomes a
  `2×2` "feature".
- ≤ 3 of any one control type land on a single panel.

No procedural panel-packing engine — this small curated system is deliberate
(YAGNI). Different players get panels that feel physically different because
footprints + slider orientation + the feature promotion vary with the type mix.

## Row height

`grid-template-rows: repeat(var(--rows), 1fr)` with
`max-height: calc(rows * 104px + gaps)` and `margin: auto 0`. Small viewports are
1fr-constrained; larger ones cap the panel and centre it. Square controls
(dial/direction) are the largest square that fits their cell, so a tall cell
leaves a little panel background around them — that is spacing between
instruments, not empty card chrome.

## Information density & hierarchy

Scanning speed beats conventional app-UI hierarchy. Priority:

```
1. ACTIVE INSTRUCTIONS   (amber strip, big bold text, per-instruction countdown bar)
2. CONTROL NAMES         (.pc__name — bold, high-contrast, up to 2 lines, never truncated to nothing)
3. INTERACTIVE SURFACES  (fill the cell)
4. CURRENT VALUES/STATE  (inside the control — toggle position, slider thumb+number, dial rotation+number, shape highlight, counters, progress fills)
5. decoration            (subtle .pc housing border)
```

- No separate large status regions — state lives in the control.
- `.pc` housing is a thin border + faint fill, not a padded "card". The HUD is a
  single compact strip; the instruction strip is capped at `32dvh`.

## What did NOT change

Control mechanics, multiplayer behaviour, the shared model, the server. The
Stage 1 playground (`/#playground`) keeps its `ControlCard` presentation; both it
and the gameplay panel render the same widgets via `ControlWidget`.
