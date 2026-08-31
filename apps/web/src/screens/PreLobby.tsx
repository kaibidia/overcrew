import { useState } from "react";
import {
  MAX_NICKNAME_LENGTH,
  ROOM_CODE_LENGTH,
  normalizeRoomCode,
  randomNickname,
} from "@overcrew/shared";
import type { RoomApi } from "../net/useRoom";

export function PreLobby({ api }: { api: RoomApi }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [nickname, setNickname] = useState("");
  const [suggestion, setSuggestion] = useState(randomNickname);
  const [code, setCode] = useState("");

  const offline = api.conn !== "online";
  // Empty field → use the offered callsign.
  const effectiveName = nickname.trim() || suggestion;
  const codeGiven = mode === "create" || code.length > 0;
  const canSubmit = codeGiven && !api.busy && !offline;

  const submit = () => {
    if (!canSubmit) return;
    if (mode === "create") api.createRoom(effectiveName);
    else api.joinRoom(code, effectiveName); // server validates the code
  };

  const shuffle = () => {
    setNickname("");
    setSuggestion((prev) => {
      let next = randomNickname();
      // avoid repeating the same suggestion twice in a row
      for (let i = 0; i < 4 && next === prev; i++) next = randomNickname();
      return next;
    });
  };

  return (
    <div className="pre">
      <h1 className="pre__logo">OVERCREW</h1>
      <p className="pre__sub">shouting co-op game</p>

      <div className="pre__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "create"}
          className={`pre__tab${mode === "create" ? " pre__tab--on" : ""}`}
          onClick={() => setMode("create")}
        >
          СОЗДАТЬ
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "join"}
          className={`pre__tab${mode === "join" ? " pre__tab--on" : ""}`}
          onClick={() => setMode("join")}
        >
          ВОЙТИ
        </button>
      </div>

      <label className="pre__field">
        <span>ПОЗЫВНОЙ</span>
        <input
          className="pre__input"
          value={nickname}
          maxLength={MAX_NICKNAME_LENGTH}
          placeholder={suggestion}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setNickname(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <span className="pre__field-hint">
          {nickname.trim()
            ? " "
            : `оставь пустым — будешь «${suggestion}»`}{" "}
          <button type="button" className="pre__reshuffle" onClick={shuffle}>
            ↻ другой
          </button>
        </span>
      </label>

      {mode === "join" && (
        <label className="pre__field">
          <span>КОД КОМНАТЫ</span>
          <input
            className="pre__input pre__input--code"
            value={code}
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={ROOM_CODE_LENGTH}
            placeholder="XXXX"
            onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <span className="pre__field-hint">
            {ROOM_CODE_LENGTH} символа с экрана капитана
          </span>
        </label>
      )}

      <button
        type="button"
        className="pre__go"
        disabled={!canSubmit}
        onClick={submit}
      >
        {api.busy
          ? "…"
          : mode === "create"
            ? "СОЗДАТЬ КОМНАТУ"
            : "ВОЙТИ В КОМНАТУ"}
      </button>

      {offline ? (
        <p className="pre__hint">Подключение к серверу… проверьте Wi-Fi.</p>
      ) : (
        <p className="pre__hint">
          Все игроки открывают эту страницу в браузере телефона в одной сети Wi-Fi.
        </p>
      )}
    </div>
  );
}
