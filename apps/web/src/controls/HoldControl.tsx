import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ControlEvent } from "./types";

interface Props {
  /** Playground demo: fill a local progress bar over this long while pressed. */
  demoMs?: number;
  /** Gameplay: whether the server currently registers this control as held. */
  held?: boolean;
  onEvent: (e: ControlEvent) => void;
}

/**
 * Press-and-hold control. Pointer down → emit `hold` start; pointer up / cancel
 * / capture loss → emit `hold` end. It shows a "holding" state immediately
 * (optimistic), confirmed by the server via `held` in gameplay. In the
 * playground (`demoMs`) it fills a local progress bar for the demo; in the game
 * the completion progress lives on the instruction, not the control.
 */
export function HoldControl({ demoMs, held, onEvent }: Props) {
  const [pressed, setPressed] = useState(false);
  const pressedRef = useRef(false);
  const [demoPct, setDemoPct] = useState(0);
  const rafRef = useRef<number | null>(null);

  const clearRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };
  useEffect(() => clearRaf, []);

  const holding = pressed || held === true;

  const begin = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (pressedRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pressedRef.current = true;
    setPressed(true);
    onEvent({ type: "hold", phase: "start" });
    if (demoMs) {
      const t0 = performance.now();
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / demoMs);
        setDemoPct(p);
        if (p < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
  };

  const end = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!pressedRef.current) return;
    pressedRef.current = false;
    setPressed(false);
    clearRaf();
    setDemoPct(0);
    onEvent({ type: "hold", phase: "end" });
  };

  const fillPct = demoMs ? Math.round(demoPct * 100) : holding ? 100 : 0;

  return (
    <button
      type="button"
      className={`hold${holding ? " hold--active" : ""}`}
      aria-pressed={holding}
      style={{ touchAction: "none" }}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <span
        className={`hold__fill${holding && !demoMs ? " hold__fill--pulse" : ""}`}
        style={{ height: `${fillPct}%` }}
      />
      <span className="hold__label">
        {holding ? "ДЕРЖИМ" : "УДЕРЖИВАТЬ"}
      </span>
      {demoMs ? (
        <span className="hold__pct">{fillPct}%</span>
      ) : null}
    </button>
  );
}
