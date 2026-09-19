import { useRoom } from "../net/useRoom";
import { PreLobby } from "./PreLobby";
import { Lobby } from "./Lobby";
import { GameScreen } from "./GameScreen";

function Splash() {
  return (
    <div className="console-screen splash splash--console">
      <div className="splash__brand" role="img" aria-label="OVERCREW" />
      <p className="splash__status">
        <span className="splash__diode" />
        Подключение к серверу…
      </p>
    </div>
  );
}

export function RoomApp() {
  const api = useRoom();

  let screen;
  let inGame = false;
  let entry = false;
  let lobby = false;
  if (!api.view) {
    entry = true;
    screen = api.conn === "connecting" ? <Splash /> : <PreLobby api={api} />;
  } else if (api.view.phase === "lobby") {
    lobby = true;
    screen = <Lobby api={api} />;
  } else {
    screen = <GameScreen api={api} />;
    inGame = true;
  }

  return (
    <div
      className={`room${inGame ? " room--game" : ""}${entry || lobby ? " room--entry" : ""}`}
    >
      {api.error && !entry && (
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
