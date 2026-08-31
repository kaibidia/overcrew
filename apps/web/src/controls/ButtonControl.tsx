import type { ControlEvent } from "./types";

interface Props {
  pressCount: number;
  onEvent: (e: ControlEvent) => void;
}

export function ButtonControl({ pressCount, onEvent }: Props) {
  return (
    <button
      type="button"
      className="big-button"
      onClick={() => onEvent({ type: "press" })}
    >
      <span className="big-button__label">НАЖАТЬ</span>
      <span className="big-button__count">{pressCount}</span>
    </button>
  );
}
