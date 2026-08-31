import { DIRECTIONS, type Direction } from "@overcrew/shared";
import type { ControlEvent } from "./types";

interface Props {
  value: Direction | null;
  onEvent: (e: ControlEvent) => void;
}

const GLYPH: Record<Direction, string> = {
  ВВЕРХ: "▲",
  ВНИЗ: "▼",
  ВЛЕВО: "◀",
  ВПРАВО: "▶",
};

const SLOT: Record<Direction, string> = {
  ВВЕРХ: "up",
  ВНИЗ: "down",
  ВЛЕВО: "left",
  ВПРАВО: "right",
};

export function DirectionControl({ value, onEvent }: Props) {
  return (
    <div className="dpad">
      {DIRECTIONS.map((d) => (
        <button
          key={d}
          type="button"
          className={`dpad__btn dpad__btn--${SLOT[d]}${
            value === d ? " dpad__btn--on" : ""
          }`}
          aria-label={d}
          aria-pressed={value === d}
          onClick={() => onEvent({ type: "direction", value: d })}
        >
          {GLYPH[d]}
        </button>
      ))}
      <span className="dpad__center">{value ? GLYPH[value] : "·"}</span>
    </div>
  );
}
