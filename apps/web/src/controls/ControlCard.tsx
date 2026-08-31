import type { ReactNode } from "react";

interface ControlCardProps {
  name: string;
  /** Short human-readable current value, shown next to the name. */
  readout: ReactNode;
  /** Highlight briefly after an interaction. */
  active: boolean;
  children: ReactNode;
}

export function ControlCard({ name, readout, active, children }: ControlCardProps) {
  return (
    <section className={`control-card${active ? " control-card--active" : ""}`}>
      <header className="control-card__head">
        <span className="control-card__name">{name}</span>
        <span className="control-card__readout">{readout}</span>
      </header>
      <div className="control-card__body">{children}</div>
    </section>
  );
}
