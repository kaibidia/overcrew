import { useRoom } from "../net/useRoom";
import { PreLobby } from "./PreLobby";
import { Lobby } from "./Lobby";
import { GameScreen } from "./GameScreen";

function Splash() {
  return (
    <div className="splash">
      <h1 className="splash__logo">OVERCREW</h1>
      <p className="splash__text">Подключение к серверу…</p>
    </div>
  );
}

export function RoomApp() {
  const api = useRoom();

  let screen;
  if (!api.view) {
    screen = api.conn === "connecting" ? <Splash /> : <PreLobby api={api} />;
  } else if (api.view.phase === "lobby") {
    screen = <Lobby api={api} />;
  } else {
    screen = <GameScreen api={api} />;
  }

  return (
    <div className="room">
      {api.error && (
        <div className="room__error" role="alert">
          <span>{api.error}</span>
          <button type="button" onClick={api.dismissError} aria-label="закрыть">
            ✕
          </button>
        </div>
      )}
      {screen}
    </div>
  );
}
