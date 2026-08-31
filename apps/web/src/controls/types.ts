import type { Direction } from "@overcrew/shared";

/** A semantic interaction emitted by a control widget. */
export type ControlEvent =
  | { type: "press" }
  | { type: "toggle"; on: boolean }
  | { type: "select"; value: string | number }
  | { type: "direction"; value: Direction }
  | { type: "dial"; position: number }
  | { type: "slider"; value: number; hit: boolean | null }
  | { type: "hold"; phase: "start" | "end" | "complete" }
  | { type: "mash" };
