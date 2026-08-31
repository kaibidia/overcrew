import type { ControlEvent } from "./types";

interface Props {
  values: ReadonlyArray<string | number>;
  value: string | number;
  onEvent: (e: ControlEvent) => void;
}

export function ShapeSelectorControl({ values, value, onEvent }: Props) {
  return (
    <div className="selector" role="group">
      {values.map((v) => (
        <button
          key={String(v)}
          type="button"
          className={`selector__cell${v === value ? " selector__cell--on" : ""}`}
          aria-pressed={v === value}
          onClick={() => onEvent({ type: "select", value: v })}
        >
          {v}
        </button>
      ))}
    </div>
  );
}
