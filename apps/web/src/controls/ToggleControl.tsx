import type { ControlEvent } from "./types";

interface Props {
  on: boolean;
  onEvent: (e: ControlEvent) => void;
}

export function ToggleControl({ on, onEvent }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`toggle${on ? " toggle--on" : ""}`}
      onClick={() => onEvent({ type: "toggle", on: !on })}
    >
      <span className="toggle__side toggle__side--off">ВЫКЛ</span>
      <span className="toggle__knob" />
      <span className="toggle__side toggle__side--on">ВКЛ</span>
    </button>
  );
}
