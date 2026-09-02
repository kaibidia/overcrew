/**
 * The chassis viewport image. Only the inner picture changes; the glass glare
 * (catchlight) sits over every insert. On error the insert swaps to the warning
 * screen — the title/message are rendered separately in HTML (see PreLobby) and
 * are never baked into the art. This element stays *behind* the chassis frame
 * overlay so the insert's corners never show.
 */
export type ViewportInsert = "planet" | "asteroid" | "ship" | "horizon";

export function Viewport({
  insert = "planet",
  error = false,
}: {
  insert?: ViewportInsert;
  error?: boolean;
}) {
  const src = error
    ? "/console/insert-error.webp"
    : `/console/insert-${insert}.webp`;
  return (
    <div className="vp">
      <img className="vp__img" src={src} alt="" />
      <img className="vp__glare" src="/console/catchlight.webp" alt="" />
    </div>
  );
}
