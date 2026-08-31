import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isSliderValueAccepted, type SliderTask } from "@overcrew/shared";
import type { ControlEvent } from "./types";

interface Props {
  min: number;
  max: number;
  /** Storage granularity — 1 for the integer 0–100 slider. */
  step: number;
  value: number;
  /** Layout representation choice — same mechanic, same behaviour. */
  orientation?: "horizontal" | "vertical";
  /** Optional demo task: on release, show whether the value landed in tolerance. */
  task?: SliderTask;
  onEvent: (e: ControlEvent) => void;
}

const clampRound = (raw: number, min: number, max: number, step: number) => {
  const snapped = Math.round(raw / step) * step;
  return Math.min(max, Math.max(min, snapped));
};

/**
 * Continuously-draggable slider, horizontal or vertical (a layout choice — the
 * 0–100 / step-1 behaviour and target/tolerance validation are identical). The
 * thumb follows the pointer; one `slider` event is emitted per settle.
 *
 * The accepted tolerance band is deliberately NOT drawn on the track.
 */
export function SliderControl({
  min,
  max,
  step,
  value,
  orientation = "horizontal",
  task,
  onEvent,
}: Props) {
  const vertical = orientation === "vertical";
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragValue, setDragValue] = useState(value);
  const [dragging, setDragging] = useState(false);
  const [outcome, setOutcome] = useState<"hit" | "miss" | null>(null);

  useEffect(() => {
    if (!dragging) setDragValue(value);
  }, [value, dragging]);

  const shown = dragging ? dragValue : value;
  const frac = (shown - min) / (max - min);

  const valueAt = (clientX: number, clientY: number) => {
    const el = trackRef.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    const f = vertical
      ? (r.bottom - clientY) / r.height
      : (clientX - r.left) / r.width;
    return clampRound(min + f * (max - min), min, max, step);
  };

  const settle = (next: number) => {
    const hit = task ? isSliderValueAccepted(next, task) : null;
    setOutcome(hit === null ? null : hit ? "hit" : "miss");
    if (next !== value || hit !== null) onEvent({ type: "slider", value: next, hit });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    trackRef.current?.setPointerCapture(e.pointerId);
    setOutcome(null);
    setDragging(true);
    setDragValue(valueAt(e.clientX, e.clientY));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.preventDefault();
    setDragValue(valueAt(e.clientX, e.clientY));
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = trackRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (!dragging) return;
    setDragging(false);
    settle(dragValue);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const big = step * 10;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value - step;
    else if (e.key === "PageUp") next = value + big;
    else if (e.key === "PageDown") next = value - big;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next === null) return;
    e.preventDefault();
    settle(Math.min(max, Math.max(min, next)));
  };

  return (
    <div
      className={`slider slider--${vertical ? "v" : "h"} slider--${outcome ?? "idle"}`}
    >
      <div className="slider__head">
        <span className="slider__value">{shown}</span>
        {task && (
          <span className="slider__task">
            → {task.targetValue} ± {task.tolerance}
            {outcome === "hit" && <b className="slider__ok"> ✓ В ДОПУСКЕ</b>}
            {outcome === "miss" && <b className="slider__miss"> МИМО</b>}
          </span>
        )}
      </div>
      <div
        ref={trackRef}
        className="slider__track"
        role="slider"
        tabIndex={0}
        aria-label="ползунок"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={shown}
        style={{ "--frac": frac } as CSSProperties}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={onKeyDown}
      >
        <span className="slider__fill" />
        <span className="slider__thumb" />
      </div>
    </div>
  );
}
