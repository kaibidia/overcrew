/**
 * The physical red actuator seated in the start plate's left socket.
 * One neutral idle image — no pressed swap. No baked text.
 */
export function RedButton({
  disabled = false,
  label,
  onClick,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="plate__btn"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    />
  );
}
