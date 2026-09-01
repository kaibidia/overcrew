import type { ControlInstance, SliderTask } from "@overcrew/shared";
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
  onEvent: (e: ControlEvent) => void;
  /** Local demo mode — the Stage 1 playground. */
  playground?: boolean;
  /** Playground-only demo task for a slider. */
  sliderTask?: SliderTask;
  /** Layout choice for a slider (gameplay panel). */
  sliderOrientation?: "horizontal" | "vertical";
}

/** The bare interactive control surface — no name label, no card chrome. */
export function ControlWidget({
  instance,
  onEvent,
  playground,
  sliderTask,
  sliderOrientation,
}: Props) {
  const playgroundHold = playground === true;
  const def = instance.definition;
  const state = instance.state;

  if (def.kind === "button" && state.kind === "button")
    return <ButtonControl onEvent={onEvent} />;

  if (def.kind === "toggle" && state.kind === "toggle")
    return <ToggleControl on={state.on} onEvent={onEvent} />;

  if (def.kind === "shapeSelector" && state.kind === "shapeSelector")
    return (
      <ShapeSelectorControl
        values={def.values}
        value={state.value}
        onEvent={onEvent}
      />
    );

  if (def.kind === "direction" && state.kind === "direction")
    return <DirectionControl value={state.value} onEvent={onEvent} />;

  if (def.kind === "dial" && state.kind === "dial")
    return (
      <DialControl
        positions={def.positions}
        position={state.position}
        onEvent={onEvent}
      />
    );

  if (def.kind === "slider" && state.kind === "slider")
    return (
      <SliderControl
        min={def.min}
        max={def.max}
        step={def.step}
        value={state.value}
        orientation={sliderOrientation}
        task={sliderTask}
        onEvent={onEvent}
      />
    );

  if (def.kind === "hold" && state.kind === "hold")
    return (
      <HoldControl
        held={state.held}
        {...(playgroundHold ? { demoMs: def.durationMs } : {})}
        onEvent={onEvent}
      />
    );

  if (def.kind === "mash" && state.kind === "mash")
    return (
      <MashControl
        targetTaps={def.targetTaps}
        taps={state.taps}
        onEvent={onEvent}
      />
    );

  return null;
}
