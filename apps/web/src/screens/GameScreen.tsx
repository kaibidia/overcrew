import type { Intent } from "@overcrew/shared";
import { ControlRenderer } from "../controls/ControlRenderer";
import type { ControlEvent } from "../controls/types";
import type { RoomApi } from "../net/useRoom";

/** Map a control widget event to a server intent. */
function toIntent(controlId: string, e: ControlEvent): Intent | null {
  switch (e.type) {
    case "press":
      return { type: "press", controlId };
    case "toggle":
      return { type: "set", controlId, value: e.on };
    case "direction":
      return { type: "set", controlId, value: e.value };
    case "select":
      return { type: "set", controlId, value: e.value };
    case "slider":
      return { type: "set", controlId, value: e.value };
    case "dial":
      return { type: "set", controlId, value: e.position };
    default:
      return null;
  }
}

export function GameScreen({ api }: { api: RoomApi }) {
  const gv = api.gameView;

  if (!gv) {
    return (
      <div className="game">
        <p className="game__loading">Загрузка панели…</p>
      </div>
    );
  }

  return (
    <div className="game">
      {api.conn === "reconnecting" && (
        <div className="lobby__reconnect">Переподключение…</div>
      )}

      <section className="game__instructions" aria-live="polite">
        <h2 className="game__ins-title">ИНСТРУКЦИИ</h2>
        {gv.instructions.length === 0 ? (
          <p className="game__ins-empty">Нет активных инструкций.</p>
        ) : (
          <ul>
            {gv.instructions.map((i) => (
              <li key={i.id} className="game__instruction">
                {i.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="game__panel">
        {gv.panel.map((instance) => (
          <ControlRenderer
            key={instance.id}
            instance={instance}
            active={false}
            onEvent={(e) => {
              const intent = toIntent(instance.id, e);
              if (intent) api.sendIntent(intent);
            }}
          />
        ))}
      </section>

      <button type="button" className="lobby__leave" onClick={api.leave}>
        ВЫЙТИ
      </button>
    </div>
  );
}
