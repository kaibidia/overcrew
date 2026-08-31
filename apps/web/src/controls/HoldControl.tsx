import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { ControlEvent } from "./types";

interface Props {
  durationMs: number;
  completed: boolean;
  onEvent: (e: ControlEvent) => void;
}

/**
 * Local hold control. Pointer down starts holding; progress fills over
 * `durationMs`; reaching the end fires a one-off `complete`. Any pointer
 * up / cancel / capture loss safely stops the hold. No multiplayer here.
 */
export function HoldControl({ durationMs, completed, onEvent }: Props) {
  const [progress, setProgress] = useState(completed ? 1 : 0);
  const [holding, setHolding] = useState(false);
  const holdingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const completedRef = useRef(completed);
  completedRef.current = completed;

  const clearRaf = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  useEffect(() => clearRaf, []);

  const tick = (startTs: number) => {
    const p = Math.min(1, (performance.now() - startTs) / durationMs);
    setProgress(p);
    if (p >= 1) {
      rafRef.current = null;
      if (!completedRef.current) onEvent({ type: "hold", phase: "complete" });
      return;
    }
    rafRef.current = requestAnimationFrame(() => tick(startTs));
  };

  const begin = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (holdingRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    holdingRef.current = true;
    setHolding(true);
    onEvent({ type: "hold", phase: "start" });
    const startTs = performance.now();
    rafRef.current = requestAnimationFrame(() => tick(startTs));
  };

  const end = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (!holdingRef.current) return;
    holdingRef.current = false;
    setHolding(false);
    clearRaf();
    onEvent({ type: "hold", phase: "end" });
    if (!completedRef.current) setProgress(0);
  };

  const pct = Math.round(progress * 100);

  return (
    <button
      type="button"
      className={`hold${completed ? " hold--done" : ""}${
        holding ? " hold--active" : ""
      }`}
      style={{ touchAction: "none" }}
      onPointerDown={begin}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <span className="hold__fill" style={{ height: `${pct}%` }} />
      <span className="hold__label">
        {completed ? "УДЕРЖАНО" : "УДЕРЖИВАТЬ"}
      </span>
      <span className="hold__pct">{pct}%</span>
    </button>
  );
}
