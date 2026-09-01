import { useMemo, type CSSProperties } from "react";
import type { ControlInstance, Intent } from "@overcrew/shared";
import { ControlWidget } from "../controls/ControlWidget";
import type { ControlEvent } from "../controls/types";
import { chooseLayout, type Placement } from "./layout";

/** Map a control widget event to a server intent. */
function toIntent(controlId: string, e: ControlEvent): Intent | null {
  switch (e.type) {
    case "press":
      return { type: "press", controlId };
    case "toggle":
      return { type: "set", controlId, value: e.on };
    case "direction":
      return { type: "set", controlId, value: e.value };
    case "select":
      return { type: "set", controlId, value: e.value };
    case "slider":
      return { type: "set", controlId, value: e.value };
    case "dial":
      return { type: "set", controlId, value: e.position };
    case "hold":
      return e.phase === "start"
        ? { type: "hold-start", controlId }
        : e.phase === "end"
          ? { type: "hold-end", controlId }
          : null;
    default:
      return null;
  }
}

interface Props {
  controls: ControlInstance[];
  onIntent: (intent: Intent) => void;
}

/**
 * The player's instrument panel: a heterogeneous 4-column grid split into
 * exactly `layout.rows` equal tracks so it always fits without scrolling.
 * Footprints and slider orientation come from `chooseLayout`.
 */
export function PanelGrid({ controls, onIntent }: Props) {
  const layout = useMemo(() => chooseLayout(controls), [controls]);
  const byId = useMemo(
    () => new Map(layout.placements.map((p) => [p.id, p])),
    [layout],
  );

  return (
    <div
      className="panel-grid"
      style={
        {
          "--cols": layout.columns,
          "--rows": layout.rows,
        } as CSSProperties
      }
    >
      {controls.map((c) => {
        const p = byId.get(c.id);
        if (!p) return null;
        return (
          <PanelCell
            key={c.id}
            instance={c}
            placement={p}
            onEvent={(e) => {
              const intent = toIntent(c.id, e);
              if (intent) onIntent(intent);
            }}
          />
        );
      })}
    </div>
  );
}

function PanelCell({
  instance,
  placement,
  onEvent,
}: {
  instance: ControlInstance;
  placement: Placement;
  onEvent: (e: ControlEvent) => void;
}) {
  const style: CSSProperties = {
    gridColumn: `${placement.col} / span ${placement.colSpan}`,
    gridRow: `${placement.row} / span ${placement.rowSpan}`,
  };
  const wide = placement.colSpan >= 4;
  return (
    <div
      className={`pc${placement.feature ? " pc--feature" : ""}${
        wide ? " pc--wide" : ""
      }`}
      style={style}
    >
      <span className="pc__name">{instance.label}</span>
      <div className="pc__widget">
        <ControlWidget
          instance={instance}
          sliderOrientation={placement.orientation}
          onEvent={onEvent}
        />
      </div>
    </div>
  );
}
