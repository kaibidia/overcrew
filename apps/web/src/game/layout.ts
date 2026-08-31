import type { ControlInstance, ControlType } from "@overcrew/shared";

/**
 * Gameplay panel layout — a small, deterministic, curated chooser (NOT a
 * general-purpose bin-packer). It builds a handful of candidate footprint sets
 * for the 4–6 controls, first-fits each onto a 4-column lattice, scores them
 * (fits · no dead space · larger useful surfaces · variety), and keeps the best.
 *
 * `ControlType` and layout are separate: a Button may be 2×1 / 2×2 / 4×1 and a
 * Slider may be horizontal (4×1) or vertical (2×2 … 2×4). An expandable control
 * (a tall vertical Slider, a feature Button) is grown into space a fixed grid
 * would leave empty.
 */

export type SliderOrientation = "horizontal" | "vertical";

export interface Placement {
  id: string;
  col: number;
  colSpan: number;
  row: number;
  rowSpan: number;
  orientation?: SliderOrientation;
  feature?: boolean;
}

export interface PanelLayout {
  columns: 4;
  rows: number;
  placements: Placement[];
}

const COLS = 4;
/** Rows beyond this won't fit the minimum supported gameplay viewport. */
const MAX_ROWS = 6;

interface Fp {
  id: string;
  kind: ControlType;
  w: number;
  h: number;
  orientation?: SliderOrientation;
  feature?: boolean;
}

function rank(f: { w: number; h: number }): number {
  if (f.w >= 2 && f.h >= 2) return 3; // square
  if (f.w >= COLS) return 2; // wide
  return 1; // small
}

/** Starting footprint for each control (before candidate expansion). */
function baseFootprints(controls: ControlInstance[]): Fp[] {
  const kinds = controls.map((c) => c.definition.kind);
  const hasFullWidth = kinds.includes("shapeSelector");
  const squareCount = kinds.filter(
    (k) => k === "dial" || k === "direction",
  ).length;
  const sliderTotal = kinds.filter((k) => k === "slider").length;
  let sliderSeen = 0;

  return controls.map((c): Fp => {
    const kind = c.definition.kind;
    switch (kind) {
      case "shapeSelector":
        return { id: c.id, kind, w: 4, h: 1 };
      case "dial":
      case "direction":
        return { id: c.id, kind, w: 2, h: 2 };
      case "slider": {
        const i = sliderSeen++;
        const vertical =
          hasFullWidth || squareCount >= 1 || (sliderTotal >= 2 && i === 1);
        return vertical
          ? { id: c.id, kind, w: 2, h: 2, orientation: "vertical" }
          : { id: c.id, kind, w: 4, h: 1, orientation: "horizontal" };
      }
      default:
        return { id: c.id, kind, w: 2, h: 1 };
    }
  });
}

const clone = (fps: Fp[]): Fp[] => fps.map((f) => ({ ...f }));
const withF = (fps: Fp[], id: string, patch: Partial<Fp>): Fp[] =>
  fps.map((f) => (f.id === id ? { ...f, ...patch } : { ...f }));

/** A handful of footprint sets to try. */
function candidates(base: Fp[]): Fp[][] {
  const sets: Fp[][] = [clone(base)];

  const vSliders = base.filter(
    (f) => f.kind === "slider" && f.orientation === "vertical",
  );
  if (vSliders.length === 1) {
    const id = vSliders[0]!.id;
    sets.push(withF(base, id, { h: 3 }));
    sets.push(withF(base, id, { h: 4 }));
  }
  if (base.some((f) => f.kind === "slider")) {
    sets.push(
      base.map((f) =>
        f.kind === "slider"
          ? { ...f, w: 4, h: 1, orientation: "horizontal" as const }
          : { ...f },
      ),
    );
  }

  const flex =
    base.find((f) => f.kind === "button") ?? base.find((f) => f.kind === "hold");
  if (flex) {
    sets.push(withF(base, flex.id, { w: 2, h: 2, feature: true }));
    sets.push(withF(base, flex.id, { w: 4, h: 1 }));
  }

  // Promote a trailing lone small to full width (keeps rows tiling cleanly).
  const smalls = base.filter((f) => f.w === 2 && f.h === 1);
  if (smalls.length % 2 === 1) {
    sets.push(withF(base, smalls[smalls.length - 1]!.id, { w: 4 }));
  }

  return sets;
}

interface Packed {
  placements: Placement[];
  rows: number;
  deadCells: number;
}

function pack(fps: Fp[]): Packed | null {
  const ordered = [...fps].sort((a, b) => rank(b) - rank(a));
  const occ: boolean[][] = [];
  const taken = (r: number, c: number) => occ[r]?.[c] === true;
  const fits = (r: number, c: number, w: number, h: number) => {
    if (c + w > COLS) return false;
    for (let i = 0; i < h; i++)
      for (let j = 0; j < w; j++) if (taken(r + i, c + j)) return false;
    return true;
  };
  const mark = (r: number, c: number, w: number, h: number) => {
    for (let i = 0; i < h; i++) {
      occ[r + i] ??= [];
      for (let j = 0; j < w; j++) occ[r + i]![c + j] = true;
    }
  };

  const placements: Placement[] = [];
  for (const f of ordered) {
    let done = false;
    for (let r = 0; r < 40 && !done; r++) {
      for (let c = 0; c < COLS && !done; c++) {
        if (fits(r, c, f.w, f.h)) {
          mark(r, c, f.w, f.h);
          placements.push({
            id: f.id,
            col: c + 1,
            colSpan: f.w,
            row: r + 1,
            rowSpan: f.h,
            ...(f.orientation ? { orientation: f.orientation } : {}),
            ...(f.feature ? { feature: true } : {}),
          });
          done = true;
        }
      }
    }
    if (!done) return null;
  }

  const rows = Math.max(1, ...placements.map((p) => p.row - 1 + p.rowSpan));
  const used = fps.reduce((s, f) => s + f.w * f.h, 0);
  return { placements, rows, deadCells: rows * COLS - used };
}

function score(packed: Packed, fps: Fp[]): number {
  if (packed.rows > MAX_ROWS) return -Infinity;
  let s = -packed.deadCells * 8 - packed.rows * 1.5;
  for (const f of fps) {
    if (f.kind === "slider" && f.h >= 3) s += (f.h - 1) * 4; // longer track
    if (f.feature) s += 5;
  }
  s += new Set(fps.map((f) => `${f.w}x${f.h}`)).size * 1.5; // footprint variety
  return s;
}

/**
 * Grow small (2×1) controls downward into any leftover empty cells, so an
 * adjacent Button/Toggle/etc. takes the space a fixed grid would waste.
 */
function fillHoles(packed: Packed): Packed {
  const occ: (string | null)[][] = Array.from({ length: packed.rows }, () =>
    Array(COLS).fill(null),
  );
  for (const p of packed.placements)
    for (let r = 0; r < p.rowSpan; r++)
      for (let c = 0; c < p.colSpan; c++)
        occ[p.row - 1 + r]![p.col - 1 + c] = p.id;

  for (const p of packed.placements) {
    if (p.colSpan !== 2 || p.rowSpan !== 1 || p.orientation) continue;
    let grown = 0;
    while (p.row - 1 + p.rowSpan + grown < packed.rows) {
      const nr = p.row - 1 + p.rowSpan + grown;
      if (occ[nr]![p.col - 1] !== null || occ[nr]![p.col] !== null) break;
      occ[nr]![p.col - 1] = p.id;
      occ[nr]![p.col] = p.id;
      grown += 1;
    }
    if (grown) {
      p.rowSpan += grown;
      p.feature = true;
    }
  }
  return packed;
}

export function chooseLayout(controls: ControlInstance[]): PanelLayout {
  const base = baseFootprints(controls);
  let best: Packed | null = null;
  let bestScore = -Infinity;

  for (const fps of candidates(base)) {
    const packed = pack(fps);
    if (!packed) continue;
    const sc = score(packed, fps);
    if (sc > bestScore) {
      bestScore = sc;
      best = packed;
    }
  }

  best ??= pack(base) ?? { placements: [], rows: 1, deadCells: 0 };
  best = fillHoles(best);
  return { columns: COLS, rows: best.rows, placements: best.placements };
}
