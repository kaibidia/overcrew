import type { ControlInstance, SliderTask } from "@overcrew/shared";
import { ControlCard } from "./ControlCard";
import { ControlWidget } from "./ControlWidget";
import type { ControlEvent } from "./types";

interface Props {
  instance: ControlInstance;
  active: boolean;
  /** Playground-only: demo task shown against a slider instance. */
  sliderTask?: SliderTask;
  onEvent: (e: ControlEvent) => void;
}

/** Short current-value string shown in the card header (playground only). */
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
      return "";
    case "hold":
      return s.held ? "ДЕРЖИМ" : "—";
    case "mash":
      return `${s.taps} / ${def.kind === "mash" ? def.targetTaps : "?"}`;
  }
}

/** Playground card: name + readout header, then the control surface. */
export function ControlRenderer({ instance, active, sliderTask, onEvent }: Props) {
  return (
    <ControlCard name={instance.label} readout={readout(instance)} active={active}>
      <ControlWidget
        instance={instance}
        playground
        sliderTask={sliderTask}
        onEvent={onEvent}
      />
    </ControlCard>
  );
}
