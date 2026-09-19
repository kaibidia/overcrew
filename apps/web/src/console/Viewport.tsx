/**
 * The chassis viewport image. Only the inner picture changes; the glass glare
 * (catchlight) sits over every insert. On error the insert swaps to the warning
 * screen — the title/message are rendered separately in HTML (see PreLobby) and
 * are never baked into the art. This element stays *behind* the chassis frame
 * overlay so the insert's corners never show.
 */
export type ViewportInsert = "planet" | "asteroid" | "ship" | "horizon";

/** distant space views for the porthole — the error screen is never in this pool */
export const NORMAL_VIEWPORT_INSERTS: ViewportInsert[] = [
  "planet",
  "horizon",
  "ship",
  "asteroid",
];

export function randomViewportInsert(): ViewportInsert {
  const i = Math.floor(Math.random() * NORMAL_VIEWPORT_INSERTS.length);
  return NORMAL_VIEWPORT_INSERTS[i] ?? "planet";
}

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
