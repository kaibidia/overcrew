import type { PointerEvent as ReactPointerEvent } from "react";
import type { ControlEvent } from "./types";

interface Props {
  targetTaps: number;
  taps: number;
  onEvent: (e: ControlEvent) => void;
}

/** Local mash control. Every tap increments toward the target; caps when done. */
export function MashControl({ targetTaps, taps, onEvent }: Props) {
  const done = taps >= targetTaps;
  const pct = targetTaps === 0 ? 0 : (taps / targetTaps) * 100;

  const tap = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!done) onEvent({ type: "mash" });
  };

  return (
    <button
      type="button"
      className={`mash${done ? " mash--done" : ""}`}
      style={{ touchAction: "manipulation" }}
      onPointerDown={tap}
    >
      <span className="mash__fill" style={{ width: `${pct}%` }} />
      <span className="mash__label">{done ? "ГОТОВО" : "ЖМИ"}</span>
      <span className="mash__count">
        {taps} / {targetTaps}
      </span>
    </button>
  );
}
