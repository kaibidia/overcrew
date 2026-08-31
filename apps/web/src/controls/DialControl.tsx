import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { ControlEvent } from "./types";

interface Props {
  positions: number;
  /** Committed position, 0-indexed. */
  position: number;
  onEvent: (e: ControlEvent) => void;
}

/** Angle in degrees of a pointer relative to an element's centre. 0° = up, clockwise positive. */
function angleFromCenter(el: HTMLElement, clientX: number, clientY: number): number {
  const r = el.getBoundingClientRect();
  const dx = clientX - (r.left + r.width / 2);
  const dy = clientY - (r.top + r.height / 2);
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

/** Signed shortest difference from `a` to `b`, in (-180, 180]. Handles the ±180 wrap. */
function shortestDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

const wrap = (i: number, n: number) => ((i % n) + n) % n;

/**
 * Directly-manipulated rotary dial. Touch/drag the dial and rotate around its
 * centre; on release it snaps to the nearest of `positions` discrete stops.
 *
 * The visual angle is accumulated from pointer-angle deltas (not read as one
 * absolute angle), so crossing the −180°/+180° boundary never makes the dial
 * jump. No +/- buttons.
 */
export function DialControl({ positions, position, onEvent }: Props) {
  const step = 360 / positions;
  const dialRef = useRef<HTMLDivElement>(null);
  const lastPointerAngle = useRef<number | null>(null);

  // Continuous visual angle; authoritative while mounted. Seeded from `position`.
  const [visualAngle, setVisualAngleState] = useState(() => position * step);
  const angleRef = useRef(visualAngle);
  const setAngle = (next: number) => {
    angleRef.current = next;
    setVisualAngleState(next);
  };

  const [dragging, setDragging] = useState(false);

  const liveIndex = wrap(Math.round(visualAngle / step), positions);

  const commit = (idx: number) => {
    const target = wrap(idx, positions);
    setAngle(idx * step);
    if (target !== position) onEvent({ type: "dial", position: target });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = dialRef.current;
    if (!el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    lastPointerAngle.current = angleFromCenter(el, e.clientX, e.clientY);
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = dialRef.current;
    if (!el || lastPointerAngle.current === null) return;
    e.preventDefault();
    const current = angleFromCenter(el, e.clientX, e.clientY);
    const delta = shortestDelta(lastPointerAngle.current, current);
    lastPointerAngle.current = current;
    setAngle(angleRef.current + delta);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = dialRef.current;
    if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    if (lastPointerAngle.current === null) return;
    lastPointerAngle.current = null;
    setDragging(false);
    commit(Math.round(angleRef.current / step));
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      commit(Math.round(angleRef.current / step) + 1);
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      commit(Math.round(angleRef.current / step) - 1);
    }
  };

  const ticks = Array.from({ length: positions }, (_, i) => i);

  return (
    <div className="dial">
      <div
        ref={dialRef}
        className={`dial__face${dragging ? " dial__face--dragging" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label="поворотный переключатель"
        aria-valuemin={1}
        aria-valuemax={positions}
        aria-valuenow={liveIndex + 1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={onKeyDown}
      >
        {ticks.map((i) => (
          <span
            key={i}
            className={`dial__tick${i === liveIndex ? " dial__tick--on" : ""}`}
            style={{ "--tick-angle": `${i * step}deg` } as CSSProperties}
          >
            {i + 1}
          </span>
        ))}
        <span
          className="dial__wheel"
          style={
            {
              transform: `rotate(${visualAngle}deg)`,
              transition: dragging ? "none" : "transform 180ms ease",
            } as CSSProperties
          }
        >
          <span className="dial__notch" />
        </span>
        <span className="dial__value">{liveIndex + 1}</span>
      </div>
    </div>
  );
}
