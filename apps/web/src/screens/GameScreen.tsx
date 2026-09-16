import { useEffect, useReducer, useRef } from "react";
import type { CrashInfo, PlayerView, PublicPlayer } from "@overcrew/shared";
import { PanelGrid } from "../game/PanelGrid";
import type { RoomApi } from "../net/useRoom";

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function plural(n: number, [one, few, many]: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** Lock page scrolling for the duration of the gameplay screen. */
function useNoScroll() {
  useEffect(() => {
    document.body.classList.add("no-scroll");
    return () => document.body.classList.remove("no-scroll");
  }, []);
}

export function GameScreen({ api }: { api: RoomApi }) {
  useNoScroll();
  const gv = api.gameView;

  // Interpolate between 1 Hz server broadcasts so timers/bars move smoothly.
  const receivedAt = useRef(Date.now());
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    receivedAt.current = Date.now();
  }, [gv]);
  useEffect(() => {
    const id = window.setInterval(bump, 200);
    return () => window.clearInterval(id);
  }, []);

  if (!gv) {
    return (
      <div className="game">
        <p className="game__loading">Загрузка панели…</p>
      </div>
    );
  }

  if (gv.ship.phase === "gameover") return <GameOver api={api} gv={gv} />;

  const since = Date.now() - receivedAt.current;
  const ship = gv.ship;
  const healthPct = Math.max(0, (ship.health / ship.maxHealth) * 100);
  const healthClass = healthPct > 55 ? "ok" : healthPct > 25 ? "warn" : "crit";

  return (
    <div className="game">
      <header className="hud">
        <div className="hud__bar">
          <span
            className={`hud__fill hud__fill--${healthClass}`}
            style={{ width: `${healthPct}%` }}
          />
        </div>
        <div className="hud__row">
          <span>УР. {ship.level}</span>
          <span>{clock(ship.elapsedMs + since)}</span>
          <span>{ship.progress} ✓</span>
          <button type="button" className="hud__leave" onClick={api.leave}>
            выйти
          </button>
        </div>
      </header>

      {api.conn === "reconnecting" && (
        <div className="lobby__reconnect">Переподключение…</div>
      )}

      <section className="instr" aria-live="polite">
        <h2 className="instr__title">ИНСТРУКЦИИ</h2>
        {gv.instructions.length === 0 ? (
          <p className="instr__empty">—</p>
        ) : (
          <ul>
            {gv.instructions.map((i) => {
              // A hold instruction shows green hold-progress; others the red countdown.
              let pct: number;
              let cls: string;
              if (i.hold) {
                const heldMs = Math.min(
                  i.hold.forMs,
                  i.hold.heldMs + (i.hold.heldMs > 0 ? since : 0),
                );
                pct = (heldMs / i.hold.forMs) * 100;
                cls = "instr__bar-fill instr__bar-fill--hold";
              } else {
                const left = Math.max(0, i.remainingMs - since);
                pct = i.totalMs > 0 ? (left / i.totalMs) * 100 : 0;
                cls = `instr__bar-fill${pct < 30 ? " instr__bar-fill--low" : ""}`;
              }
              return (
                <li key={i.id} className="instr__row">
                  <span className="instr__text">{i.text}</span>
                  <span className="instr__bar">
                    <span className={cls} style={{ width: `${pct}%` }} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <PanelGrid controls={gv.panel} onIntent={api.sendIntent} />
    </div>
  );
}

/** "«ГИРОСКОП → ВВЕРХ» не выполнено вовремя — в ответе Комета." */
function crashCauseText(crash: CrashInfo, players: readonly PublicPlayer[]): string {
  if (crash.reason === "crew") {
    return "На борту осталось меньше двух игроков.";
  }
  if (crash.instructionText && crash.responsiblePlayerId) {
    const name =
      players.find((p) => p.id === crash.responsiblePlayerId)?.nickname ??
      "неизвестный игрок";
    return `«${crash.instructionText}» не выполнено вовремя — в ответе ${name}.`;
  }
  return "Здоровье корабля исчерпано.";
}

function formatAvgMs(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(1)}с`;
}

function GameOver({ api, gv }: { api: RoomApi; gv: PlayerView }) {
  useNoScroll();
  const ship = gv.ship;
  const iAmHost =
    gv.room.players.find((p) => p.id === gv.you)?.isHost === true;
  const board = gv.scoreboard;

  return (
    <div className="over">
      <h1 className="over__title">
        {ship.overReason === "crew" ? "ЭКИПАЖ РАСПАЛСЯ" : "КОРАБЛЬ ПОТЕРЯН"}
      </h1>
      <div className="over__stats">
        <div>
          <b>{ship.progress}</b>
          <span>{plural(ship.progress, ["задача", "задачи", "задач"])}</span>
        </div>
        <div>
          <b>{clock(ship.elapsedMs)}</b>
          <span>в полёте</span>
        </div>
        <div>
          <b>{ship.level}</b>
          <span>уровень</span>
        </div>
      </div>

      {board && (
        <div className="over__board">
          {board.crash && (
            <p className="over__cause">{crashCauseText(board.crash, gv.room.players)}</p>
          )}
          <div className="over__board-head">
            <span className="over__board-name">игрок</span>
            <span>перед.</span>
            <span>вып.</span>
            <span>пров.</span>
            <span>сред.</span>
          </div>
          <ul className="over__board-list">
            {board.players.map((p) => {
              const nickname =
                gv.room.players.find((pl) => pl.id === p.playerId)?.nickname ??
                p.playerId;
              return (
                <li
                  key={p.playerId}
                  className={`over__board-row${p.causedCrash ? " over__board-row--crash" : ""}`}
                >
                  <span className="over__board-name">
                    {nickname}
                    {p.playerId === gv.you && " (ты)"}
                  </span>
                  <span>{p.transmitted}</span>
                  <span>{p.executed}</span>
                  <span>{p.failed}</span>
                  <span>{formatAvgMs(p.avgExecutionMs)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {iAmHost ? (
        <button type="button" className="pre__go" onClick={api.restart}>
          ЗАНОВО
        </button>
      ) : (
        <p className="lobby__note">Ждём капитана…</p>
      )}
      <button type="button" className="lobby__leave" onClick={api.leave}>
        ВЫЙТИ
      </button>
    </div>
  );
}
