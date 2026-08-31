import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ControlEvent } from "./types";

interface Props {
  onEvent: (e: ControlEvent) => void;
}

/**
 * A physical round push button. One press is an action — no counter, no
 * "НАЖАТЬ" text, no rectangular app surface. Idle = raised dome; held =
 * depressed; just-activated = a brief glow.
 */
export function ButtonControl({ onEvent }: Props) {
  const [pressed, setPressed] = useState(false);
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setPressed(true);
    onEvent({ type: "press" });
    setFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 320);
  };

  const up = () => setPressed(false);

  return (
    <button
      type="button"
      className="pushbtn"
      aria-label="кнопка"
      style={{ touchAction: "none" }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    >
      <span
        className={`pushbtn__cap${pressed ? " pushbtn__cap--down" : ""}${
          flash ? " pushbtn__cap--flash" : ""
        }`}
      />
    </button>
  );
}
