import { createSamplePanel, type ControlInstance } from "@overcrew/shared";
import type { ControlEvent } from "../controls/types";
import { applyEvent } from "./reduce";

export interface LogEntry {
  id: number;
  text: string;
}

export interface PlaygroundState {
  panel: ControlInstance[];
  log: LogEntry[];
  activeId: string | null;
  nextLogId: number;
  /** Bumped on reset so control widgets remount and drop internal state. */
  generation: number;
}

export type PlaygroundAction =
  | { type: "event"; controlId: string; event: ControlEvent }
  | { type: "clearActive" }
  | { type: "reset" };

const LOG_LIMIT = 8;

export function initState(): PlaygroundState {
  return {
    panel: createSamplePanel(),
    log: [],
    activeId: null,
    nextLogId: 1,
    generation: 0,
  };
}

export function reducer(
  state: PlaygroundState,
  action: PlaygroundAction,
): PlaygroundState {
  switch (action.type) {
    case "event": {
      const idx = state.panel.findIndex((c) => c.id === action.controlId);
      if (idx === -1) return state;
      const target = state.panel[idx]!;
      const { state: nextControlState, logLine } = applyEvent(target, action.event);

      const panel = state.panel.slice();
      panel[idx] = { ...target, state: nextControlState };

      const entry: LogEntry = { id: state.nextLogId, text: logLine };
      return {
        ...state,
        panel,
        log: [entry, ...state.log].slice(0, LOG_LIMIT),
        activeId: action.controlId,
        nextLogId: state.nextLogId + 1,
      };
    }
    case "clearActive":
      return state.activeId === null ? state : { ...state, activeId: null };
    case "reset":
      return { ...initState(), generation: state.generation + 1 };
  }
}
