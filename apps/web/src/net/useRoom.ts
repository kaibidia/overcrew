import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  ClientEvent,
  PROTOCOL_VERSION,
  ServerEvent,
  normalizeRoomCode,
  type Ack,
  type Intent,
  type PlayerView,
  type RoomJoinedData,
  type RoomView,
} from "@overcrew/shared";
import { clearSession, loadSession, saveSession } from "./session";

function serverUrl(): string {
  const override = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (override) return override;
  const port = (import.meta.env.VITE_SERVER_PORT as string | undefined) ?? "3001";
  return `${window.location.protocol}//${window.location.hostname}:${port}`;
}

export type ConnState = "connecting" | "online" | "reconnecting";

export interface RoomApi {
  conn: ConnState;
  view: RoomView | null;
  gameView: PlayerView | null;
  youId: string | null;
  error: string | null;
  busy: boolean;
  createRoom: (nickname: string) => void;
  joinRoom: (code: string, nickname: string) => void;
  leave: () => void;
  start: () => void;
  sendIntent: (intent: Intent) => void;
  dismissError: () => void;
}

export function useRoom(): RoomApi {
  const socketRef = useRef<Socket | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [view, setView] = useState<RoomView | null>(null);
  const [gameView, setGameView] = useState<PlayerView | null>(null);
  const [youId, setYouId] = useState<string | null>(
    () => loadSession()?.playerId ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const socket = io(serverUrl(), { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    // Don't sit on the splash forever if the server is unreachable.
    const splashTimeout = window.setTimeout(() => {
      setConn((c) => (c === "connecting" ? "reconnecting" : c));
    }, 4000);

    const onConnect = () => {
      const session = loadSession();
      if (session) {
        socket.emit(
          ClientEvent.Resume,
          { token: session.token },
          (r: Ack<RoomJoinedData>) => {
            if (r.ok) {
              saveSession(r.data.session);
              setYouId(r.data.session.playerId);
              setView(r.data.view);
              setConn("online");
            } else {
              clearSession();
              setYouId(null);
              setView(null);
              setConn("online");
            }
          },
        );
      } else {
        setConn("online");
      }
    };

    const onDisconnect = () => {
      setConn((c) => (c === "connecting" ? "connecting" : "reconnecting"));
    };

    const onState = (v: RoomView) => {
      if (v.protocolVersion !== PROTOCOL_VERSION) {
        setError("Версия игры обновилась — перезагрузите страницу.");
        return;
      }
      setView(v);
      setConn("online");
      if (v.phase === "lobby") setGameView(null);
    };

    const onPlayerView = (pv: PlayerView) => {
      setGameView(pv);
      setView(pv.room);
      setConn("online");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on(ServerEvent.RoomState, onState);
    socket.on(ServerEvent.PlayerView, onPlayerView);

    return () => {
      window.clearTimeout(splashTimeout);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(ServerEvent.RoomState, onState);
      socket.off(ServerEvent.PlayerView, onPlayerView);
      socket.close();
      socketRef.current = null;
    };
  }, []);

  const enter = useCallback(
    (event: string, payload: unknown) => {
      const socket = socketRef.current;
      if (!socket) return;
      if (!socket.connected) {
        setError("Нет связи с сервером. Проверьте Wi-Fi и попробуйте снова.");
        return;
      }
      setBusy(true);
      setError(null);
      socket
        .timeout(6000)
        .emit(event, payload, (err: Error | null, r?: Ack<RoomJoinedData>) => {
          setBusy(false);
          if (err || !r) {
            setError("Сервер не отвечает. Попробуйте ещё раз.");
            return;
          }
          if (r.ok) {
            saveSession(r.data.session);
            setYouId(r.data.session.playerId);
            setView(r.data.view);
          } else {
            setError(r.message);
          }
        });
    },
    [],
  );

  const createRoom = useCallback(
    (nickname: string) => enter(ClientEvent.CreateRoom, { nickname }),
    [enter],
  );

  const joinRoom = useCallback(
    (code: string, nickname: string) =>
      enter(ClientEvent.JoinRoom, { code: normalizeRoomCode(code), nickname }),
    [enter],
  );

  const leave = useCallback(() => {
    socketRef.current?.emit(ClientEvent.Leave, {}, () => undefined);
    clearSession();
    setView(null);
    setGameView(null);
    setYouId(null);
    setError(null);
  }, []);

  const start = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Нет связи с сервером.");
      return;
    }
    setError(null);
    socket
      .timeout(6000)
      .emit(ClientEvent.Start, {}, (err: Error | null, r?: Ack<null>) => {
        if (err || !r) setError("Сервер не отвечает.");
        else if (!r.ok) setError(r.message);
      });
  }, []);

  const sendIntent = useCallback((intent: Intent) => {
    socketRef.current?.emit(ClientEvent.Intent, intent);
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return {
    conn,
    view,
    gameView,
    youId,
    error,
    busy,
    createRoom,
    joinRoom,
    leave,
    start,
    sendIntent,
    dismissError,
  };
}
