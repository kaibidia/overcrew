import type { ControlInstance, ControlState } from "@overcrew/shared";
import type { ControlEvent } from "../controls/types";

export interface Applied {
  state: ControlState;
  /** Russian log line describing what happened, e.g. "ТУРБОЖАБА → ◆". */
  logLine: string;
}

/** Apply a widget event to one control, returning its next state + a log line. */
export function applyEvent(instance: ControlInstance, e: ControlEvent): Applied {
  const label = instance.label;
  const s = instance.state;

  switch (e.type) {
    case "press":
      if (s.kind !== "button") break;
      return {
        state: { kind: "button", pressCount: s.pressCount + 1 },
        logLine: `${label} — нажато`,
      };
    case "toggle":
      return {
        state: { kind: "toggle", on: e.on },
        logLine: `${label} → ${e.on ? "ВКЛ" : "ВЫКЛ"}`,
      };
    case "select":
      return {
        state: { kind: "shapeSelector", value: e.value },
        logLine: `${label} → ${e.value}`,
      };
    case "direction":
      return {
        state: { kind: "direction", value: e.value },
        logLine: `${label} → ${e.value}`,
      };
    case "dial":
      // Positions are stored 0-indexed but presented 1-indexed.
      return {
        state: { kind: "dial", position: e.position },
        logLine: `${label} → ${e.position + 1}`,
      };
    case "slider": {
      const mark = e.hit === true ? " ✓" : e.hit === false ? " ·" : "";
      return {
        state: { kind: "slider", value: e.value },
        logLine: `${label} → ${e.value}${mark}`,
      };
    }
    case "hold": {
      if (s.kind !== "hold") break;
      if (e.phase === "start")
        return { state: { kind: "hold", held: true }, logLine: `${label} — держим` };
      if (e.phase === "end")
        return { state: { kind: "hold", held: false }, logLine: `${label} — отпущено` };
      return { state: s, logLine: `${label} → УДЕРЖАНО` };
    }
    case "mash": {
      if (s.kind !== "mash") break;
      const def = instance.definition;
      const target = def.kind === "mash" ? def.targetTaps : 0;
      const taps = Math.min(target, s.taps + 1);
      return {
        state: { kind: "mash", taps },
        logLine:
          taps >= target
            ? `${label} → ×${target} ГОТОВО`
            : `${label} → ${taps} / ${target}`,
      };
    }
  }

  // Unreachable for well-formed (event, control) pairs.
  return { state: s, logLine: `${label} — ?` };
}
