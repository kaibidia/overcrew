import { useState } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  canStart,
  connectedCount,
} from "@overcrew/shared";
import type { RoomApi } from "../net/useRoom";

export function Lobby({ api }: { api: RoomApi }) {
  const { view, youId } = api;
  const [copied, setCopied] = useState(false);
  if (!view) return null;

  const me = view.players.find((p) => p.id === youId);
  const iAmHost = me?.isHost === true;
  const startable = canStart(view, youId ?? "");
  const connected = connectedCount(view.players);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(view.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is on screen anyway */
    }
  };

  return (
    <div className="lobby">
      {api.conn === "reconnecting" && (
        <div className="lobby__reconnect">Переподключение…</div>
      )}

      <div className="lobby__code-box">
        <span className="lobby__code-label">КОД КОМНАТЫ</span>
        <button type="button" className="lobby__code" onClick={copyCode}>
          {view.code}
        </button>
        <span className="lobby__code-hint">
          {copied ? "скопировано" : "нажми, чтобы скопировать"}
        </span>
      </div>

      <div className="lobby__roster">
        <div className="lobby__roster-head">
          <span>ЭКИПАЖ</span>
          <span>
            {view.players.length} / {MAX_PLAYERS}
          </span>
        </div>
        <ul>
          {view.players.map((p) => (
            <li
              key={p.id}
              className={`lobby__player${
                p.connection === "disconnected" ? " lobby__player--off" : ""
              }`}
            >
              <span
                className={`lobby__dot${
                  p.connection === "connected" ? " lobby__dot--on" : ""
                }`}
              />
              <span className="lobby__name">
                {p.nickname}
                {p.id === youId && " (ты)"}
                {p.connection === "disconnected" && (
                  <span className="lobby__off-tag"> · отключён</span>
                )}
              </span>
              {p.isHost && <span className="lobby__host">КАПИТАН</span>}
            </li>
          ))}
        </ul>
      </div>

      {iAmHost ? (
        <>
          <button
            type="button"
            className="lobby__start"
            disabled={!startable}
            onClick={api.start}
          >
            НАЧАТЬ
          </button>
          {!startable && (
            <p className="lobby__note">
              Нужно минимум {MIN_PLAYERS_TO_START} подключённых игрока (сейчас{" "}
              {connected}).
            </p>
          )}
        </>
      ) : (
        <p className="lobby__note">Ждём, пока капитан начнёт игру…</p>
      )}

      <button type="button" className="lobby__leave" onClick={api.leave}>
        ВЫЙТИ
      </button>
    </div>
  );
}
