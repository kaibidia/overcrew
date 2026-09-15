import { useLayoutEffect, useRef, useState } from "react";
import { MAX_PLAYERS, MIN_PLAYERS_TO_START, canStart } from "@overcrew/shared";
import type { RoomApi } from "../net/useRoom";
import { RedButton } from "../console/RedButton";

/**
 * navigator.clipboard needs a secure context — which http:// on the LAN IP
 * (exactly how phones reach the game) is not. Fall back to the execCommand
 * trick there.
 */
function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return Promise.resolve(ok);
  } catch {
    return Promise.resolve(false);
  }
}

interface ScrollState {
  overflow: boolean;
  /** Both in %, but of the thumb's own travel range inside the track's
   * inner channel (see CHANNEL_TOP/CHANNEL_SPAN below), not of the track. */
  top: number;
  height: number;
}

const NO_SCROLL: ScrollState = { overflow: false, top: 0, height: 100 };

// The scrollbar-track asset bakes its up/down arrow caps into the outer
// ~13% at each end; this is the inner band the thumb actually travels.
const CHANNEL_TOP = 13;
const CHANNEL_SPAN = 74;

/**
 * Waiting-room screen — the same physical console as PreLobby, in a
 * different state. The monitor, chassis and START plate are reused
 * byte-for-byte in their screen-1 positions; the create/join module,
 * callsign field and refresh knob simply don't exist here, and their
 * vertical space is occupied by the crew roster instead.
 */
export function Lobby({ api }: { api: RoomApi }) {
  const { view, youId } = api;
  const rowsRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState<ScrollState>(NO_SCROLL);
  const [codeCopied, setCodeCopied] = useState(false);

  // The roster shows presence only — no ready state. A row exists only for
  // a player who is actually connected right now; a dropped phone (still in
  // its reconnect grace window) simply isn't listed until it comes back.
  const crew = (view?.players ?? []).filter((p) => p.connection === "connected");

  const measure = () => {
    const el = rowsRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 1) {
      setScroll(NO_SCROLL);
      return;
    }
    const heightFrac = (el.clientHeight / el.scrollHeight) * 100;
    const topFrac = (el.scrollTop / max) * (100 - heightFrac);
    setScroll({ overflow: true, top: topFrac, height: heightFrac });
  };

  // re-measure whenever the roster itself changes size (join/leave), not
  // just on scroll — a shrinking list can turn overflow off entirely
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measure, [crew.length]);

  if (!view) return null;

  const iAmHost = view.players.find((p) => p.id === youId)?.isHost === true;
  const enoughPlayers = crew.length >= MIN_PLAYERS_TO_START;
  const startable = canStart(view, youId ?? "");
  const busy = api.busy;
  const reconnecting = api.conn === "reconnecting";

  const actionLabel = busy ? "…" : "НАЧАТЬ";
  const actionDisabled = busy || reconnecting || !iAmHost || !startable;

  // Backlit status strip in the plate, right of the actuator. Always shown
  // (fixed slot, no layout shift); a non-host in a room is never alone, so
  // the "need one more" line only ever reaches the captain.
  const crewReady = enoughPlayers && iAmHost;
  const statusText = reconnecting
    ? "ПЕРЕПОДКЛЮЧЕНИЕ…"
    : !enoughPlayers
      ? "НУЖЕН ЕЩЁ 1 ИГРОК"
      : iAmHost
        ? "ЭКИПАЖ СОБРАН"
        : "ОЖИДАЕМ КАПИТАНА";

  const thumbHeight = (scroll.height / 100) * CHANNEL_SPAN;
  const thumbTop = CHANNEL_TOP + (scroll.top / 100) * CHANNEL_SPAN;

  const copyCode = () => {
    void copyToClipboard(view.code).then((ok) => {
      if (!ok) return;
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 1600);
    });
  };

  return (
    <div className="console-screen">
      <div className="console">
        <div className="codescreen" aria-hidden="true" />
        <div className="console__frame" aria-hidden="true" />
        <button
          type="button"
          className="vp__code"
          onClick={copyCode}
          aria-label={`Код комнаты ${view.code} — нажмите, чтобы скопировать`}
        >
          <span className="vp__code-label">КОД КОМНАТЫ</span>
          <span className="vp__code-value">{view.code}</span>
          <span className="vp__code-hint">
            {codeCopied ? "Скопировано" : "Нажми, чтобы скопировать"}
          </span>
        </button>

        {/* F. crew roster — plain plate, header and rows are HTML. Only
            players connected right now get a row; the list scrolls once
            more than fit at once (capacity 4 visible, up to 8 total). */}
        <div className="crew">
          <div className="crew__head">
            <span>ЭКИПАЖ</span>
            <span className="crew__head-rule" aria-hidden="true" />
            <span className="crew__head-count">
              {crew.length} / {MAX_PLAYERS}
            </span>
          </div>

          <div className="crew__rows" ref={rowsRef} onScroll={measure}>
            {crew.map((p) => (
              <div className="crew__row" key={p.id}>
                <span className="crew__led crew__led--on" />
                <span className="crew__id">
                  <span className="crew__name">{p.nickname}</span>
                  {p.id === youId && <span className="crew__you">(ты)</span>}
                </span>
                {p.isHost && <span className="crew__badge">КАПИТАН</span>}
              </div>
            ))}
          </div>

          {scroll.overflow && (
            <div className="crew__scroll" aria-hidden="true">
              <span
                className="crew__scroll-thumb"
                style={{ top: `${thumbTop}%`, height: `${thumbHeight}%` }}
              />
            </div>
          )}
        </div>

        {/* E. start plate — identical position/asset to screen 1. Only the
            captain acts on it; the label + status strip stack to its right. */}
        <div className="plate">
          <RedButton
            label={actionLabel}
            disabled={actionDisabled}
            onClick={api.start}
          />
          <div className="plate__stack">
            <span
              className={`plate__action${actionDisabled ? " plate__action--dim" : ""}`}
            >
              {actionLabel}
            </span>
            <span
              className={`plate__status${crewReady ? " plate__status--ready" : ""}`}
            >
              {statusText}
            </span>
          </div>
        </div>

        {/* G. back/exit */}
        <button type="button" className="exit" onClick={api.leave}>
          <span className="exit__label">ВЫЙТИ</span>
        </button>
      </div>
    </div>
  );
}
