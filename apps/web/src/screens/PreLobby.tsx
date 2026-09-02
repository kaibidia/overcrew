import { useState } from "react";
import {
  MAX_NICKNAME_LENGTH,
  ROOM_CODE_LENGTH,
  normalizeRoomCode,
  randomNickname,
} from "@overcrew/shared";
import type { RoomApi } from "../net/useRoom";
import { Viewport, type ViewportInsert } from "../console/Viewport";
import { RedButton } from "../console/RedButton";

/** distant space views for the porthole — error screen is NOT in this pool */
const NORMAL_INSERTS: ViewportInsert[] = ["planet", "horizon", "ship", "asteroid"];

export function PreLobby({ api }: { api: RoomApi }) {
  const [mode, setMode] = useState<"create" | "join">("create");
  const [nickname, setNickname] = useState("");
  const [suggestion, setSuggestion] = useState(randomNickname);
  const [code, setCode] = useState("");
  // picked once when the start screen mounts; stays stable across re-renders
  // and is restored after an error clears
  const [screenInsert] = useState(
    () => NORMAL_INSERTS[Math.floor(Math.random() * NORMAL_INSERTS.length)],
  );

  const offline = api.conn !== "online";
  const effectiveName = nickname.trim() || suggestion;
  const codeGiven = mode === "create" || code.length > 0;
  const canSubmit = codeGiven && !api.busy && !offline;

  const submit = () => {
    if (!canSubmit) return;
    if (mode === "create") api.createRoom(effectiveName);
    else api.joinRoom(code, effectiveName);
  };

  const shuffle = () => {
    setNickname("");
    setSuggestion((prev) => {
      let next = randomNickname();
      for (let i = 0; i < 4 && next === prev; i++) next = randomNickname();
      return next;
    });
  };

  const error = offline
    ? { title: "НЕТ СВЯЗИ", message: "Проверьте Wi-Fi" }
    : api.error
      ? { title: "ОШИБКА", message: api.error }
      : null;

  const actionText = api.busy
    ? "…"
    : mode === "create"
      ? "СОЗДАТЬ КОМНАТУ"
      : "ВОЙТИ В КОМНАТУ";

  const cells = Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => code[i] ?? "");

  return (
    <div className="console-screen">
      <div className="console">
        <Viewport insert={screenInsert} error={error !== null} />
        <div className="console__frame" aria-hidden="true" />
        {error && (
          <div className="vp__err" role="alert">
            <b>{error.title}</b>
            {error.message && <span>{error.message}</span>}
          </div>
        )}

        <div className="brand" role="img" aria-label="OVERCREW" />

        {/* C. mode module */}
        <div className="mode" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "create"}
            className={`mode__seg mode__seg--left${mode === "create" ? " mode__seg--on" : ""}`}
            onClick={() => setMode("create")}
          >
            <span>СОЗДАТЬ</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "join"}
            className={`mode__seg mode__seg--right${mode === "join" ? " mode__seg--on" : ""}`}
            onClick={() => setMode("join")}
          >
            <span>ВОЙТИ</span>
          </button>
        </div>

        {/* D. callsign module */}
        <div className="nick">
          <span className="nick__label">ПОЗЫВНОЙ</span>
          <input
            className="nick__field"
            aria-label="Позывной"
            value={nickname}
            maxLength={MAX_NICKNAME_LENGTH}
            placeholder={suggestion}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          <button
            type="button"
            className="nick__refresh"
            aria-label="Другой позывной"
            onClick={shuffle}
          />
        </div>

        {/* E. start plate — the red actuator plus, by mode, the action
            label (CREATE) or the room-code module (JOIN), laid out as one
            local horizontal composition inside the plate */}
        <div className="plate">
          <RedButton
            label={actionText}
            disabled={!canSubmit}
            onClick={submit}
          />
          {mode === "create" ? (
            <span
              className={`plate__action${canSubmit ? "" : " plate__action--dim"}`}
            >
              {actionText}
            </span>
          ) : (
            <div className="code">
              <span className="code__label">КОД КОМНАТЫ</span>
              <div className="code__cells" aria-hidden="true">
                {cells.map((ch, i) => (
                  <span key={i} className="code__cell">
                    {ch}
                  </span>
                ))}
              </div>
              <input
                className="code__input"
                aria-label="Код комнаты"
                value={code}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={ROOM_CODE_LENGTH}
                onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
