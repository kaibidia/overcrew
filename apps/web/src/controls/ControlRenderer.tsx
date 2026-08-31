import type { ControlInstance, SliderTask } from "@overcrew/shared";
import { ControlCard } from "./ControlCard";
import { ButtonControl } from "./ButtonControl";
import { ToggleControl } from "./ToggleControl";
import { ShapeSelectorControl } from "./ShapeSelectorControl";
import { DirectionControl } from "./DirectionControl";
import { DialControl } from "./DialControl";
import { SliderControl } from "./SliderControl";
import { HoldControl } from "./HoldControl";
import { MashControl } from "./MashControl";
import type { ControlEvent } from "./types";

interface Props {
  instance: ControlInstance;
  active: boolean;
  /** Playground-only: demo task shown against a slider instance. */
  sliderTask?: SliderTask;
  onEvent: (e: ControlEvent) => void;
}

/** Short current-value string shown in the card header. */
export function readout(instance: ControlInstance): string {
  const s = instance.state;
  const def = instance.definition;
  switch (s.kind) {
    case "button":
      return s.pressCount === 0 ? "—" : `×${s.pressCount}`;
    case "toggle":
      return s.on ? "ВКЛ" : "ВЫКЛ";
    case "shapeSelector":
      return String(s.value);
    case "direction":
      return s.value ?? "—";
    case "dial":
      return String(s.position + 1);
    case "slider":
      // The slider renders its own prominent value — no duplicate in the header.
      return "";
    case "hold":
      return s.completed ? "ГОТОВО" : "—";
    case "mash":
      return `${s.taps} / ${def.kind === "mash" ? def.targetTaps : "?"}`;
  }
}

export function ControlRenderer({ instance, active, sliderTask, onEvent }: Props) {
  const def = instance.definition;
  const state = instance.state;

  return (
    <ControlCard name={instance.label} readout={readout(instance)} active={active}>
      {def.kind === "button" && state.kind === "button" && (
        <ButtonControl pressCount={state.pressCount} onEvent={onEvent} />
      )}
      {def.kind === "toggle" && state.kind === "toggle" && (
        <ToggleControl on={state.on} onEvent={onEvent} />
      )}
      {def.kind === "shapeSelector" && state.kind === "shapeSelector" && (
        <ShapeSelectorControl
          values={def.values}
          value={state.value}
          onEvent={onEvent}
        />
      )}
      {def.kind === "direction" && state.kind === "direction" && (
        <DirectionControl value={state.value} onEvent={onEvent} />
      )}
      {def.kind === "dial" && state.kind === "dial" && (
        <DialControl
          positions={def.positions}
          position={state.position}
          onEvent={onEvent}
        />
      )}
      {def.kind === "slider" && state.kind === "slider" && (
        <SliderControl
          min={def.min}
          max={def.max}
          step={def.step}
          value={state.value}
          task={sliderTask}
          onEvent={onEvent}
        />
      )}
      {def.kind === "hold" && state.kind === "hold" && (
        <HoldControl
          durationMs={def.durationMs}
          completed={state.completed}
          onEvent={onEvent}
        />
      )}
      {def.kind === "mash" && state.kind === "mash" && (
        <MashControl
          targetTaps={def.targetTaps}
          taps={state.taps}
          onEvent={onEvent}
        />
      )}
    </ControlCard>
  );
}
