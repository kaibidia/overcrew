import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import {
  ClientEvent,
  ServerEvent,
  isValidRoomCode,
  normalizeRoomCode,
  type Ack,
  type CreateRoomReq,
  type IntentAck,
  type Intent,
  type JoinRoomReq,
  type ResumeReq,
  type RoomJoinedData,
} from "@overcrew/shared";
import { RoomError, RoomManager, type Member, type Room } from "./rooms";
import { Game } from "./game";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "0.0.0.0";

const http = createServer();
const io = new Server(http, {
  // Dev: the web client is served from a different origin (Vite :5173).
  cors: { origin: true, credentials: true },
});

/** In-game state per room, created on `room:start`. */
const games = new Map<string, Game>();

function disposeGame(code: string): void {
  games.get(code)?.stop();
  games.delete(code);
}

const rooms = new RoomManager({
  onChange: (room) => {
    io.to(roomChannel(room)).emit(ServerEvent.RoomState, room.view());
    const game = games.get(room.code);
    if (game) broadcastGame(room, game);
  },
  onDispose: disposeGame,
  onMemberDropped: (room, playerId) => {
    const game = games.get(room.code);
    if (game && !game.isOver) game.removePlayer(playerId);
    if (game) broadcastGame(room, game);
  },
});

function roomChannel(room: Room): string {
  return `room:${room.code}`;
}

interface SocketData {
  token?: string;
}

function bind(socket: Socket, room: Room, member: Member): void {
  (socket.data as SocketData).token = member.token;
  rooms.attach(member.token, socket.id);
  socket.join(roomChannel(room));
}

function joinedData(room: Room, member: Member): RoomJoinedData {
  return {
    session: {
      playerId: member.id,
      token: member.token,
      roomCode: room.code,
    },
    view: room.view(),
  };
}

/** Send each connected member their own filtered PlayerView. */
function broadcastGame(room: Room, game: Game): void {
  // The game ending flips the room to the "gameover" phase.
  if (game.isOver && room.phase === "playing") {
    room.phase = "gameover";
    io.to(roomChannel(room)).emit(ServerEvent.RoomState, room.view());
  }
  const view = room.view();
  for (const m of room.members) {
    if (m.socketId) {
      io.to(m.socketId).emit(ServerEvent.PlayerView, game.viewFor(view, m.id));
    }
  }
}

function fail(ack: (r: Ack<never>) => void, err: unknown): void {
  if (err instanceof RoomError) {
    ack({ ok: false, error: err.code, message: err.message });
  } else {
    console.error("unexpected handler error", err);
    ack({ ok: false, error: "bad_request", message: "Ошибка сервера" });
  }
}

io.on("connection", (socket) => {
  socket.on(
    ClientEvent.CreateRoom,
    (req: CreateRoomReq, ack: (r: Ack<RoomJoinedData>) => void) => {
      try {
        if (typeof req?.nickname !== "string")
          throw new RoomError("bad_request", "Нужно имя");
        const { room, member } = rooms.createRoom(req.nickname);
        bind(socket, room, member);
        ack({ ok: true, data: joinedData(room, member) });
      } catch (err) {
        fail(ack, err);
      }
    },
  );

  socket.on(
    ClientEvent.JoinRoom,
    (req: JoinRoomReq, ack: (r: Ack<RoomJoinedData>) => void) => {
      try {
        const code = normalizeRoomCode(req?.code ?? "");
        if (!isValidRoomCode(code))
          throw new RoomError("not_found", "Неверный код");
        if (typeof req?.nickname !== "string")
          throw new RoomError("bad_request", "Нужно имя");
        const { room, member } = rooms.joinRoom(code, req.nickname);
        bind(socket, room, member);
        ack({ ok: true, data: joinedData(room, member) });
      } catch (err) {
        fail(ack, err);
      }
    },
  );

  socket.on(
    ClientEvent.Resume,
    (req: ResumeReq, ack: (r: Ack<RoomJoinedData>) => void) => {
      try {
        if (typeof req?.token !== "string")
          throw new RoomError("expired", "Сессия истекла");
        const { room, member } = rooms.resume(req.token);
        bind(socket, room, member);
        ack({ ok: true, data: joinedData(room, member) });
        const game = games.get(room.code);
        if (game) {
          io.to(socket.id).emit(
            ServerEvent.PlayerView,
            game.viewFor(room.view(), member.id),
          );
        }
      } catch (err) {
        fail(ack, err);
      }
    },
  );

  socket.on(ClientEvent.Leave, (_req: unknown, ack?: (r: Ack<null>) => void) => {
    const token = (socket.data as SocketData).token;
    if (token) {
      const room = rooms.getRoomByToken(token);
      if (room) socket.leave(roomChannel(room));
      rooms.leave(token);
      (socket.data as SocketData).token = undefined;
    }
    ack?.({ ok: true, data: null });
  });

  socket.on(ClientEvent.Start, (_req: unknown, ack: (r: Ack<null>) => void) => {
    try {
      const token = (socket.data as SocketData).token;
      if (!token) throw new RoomError("expired", "Сессия истекла");
      const room = rooms.startGame(token); // flips phase, broadcasts room:state
      disposeGame(room.code); // in case a previous game lingered
      const game = new Game(room.members.map((m) => m.id));
      games.set(room.code, game);
      console.log(`game ${room.code} seed=${game.seed}`);
      game.start(() => broadcastGame(room, game));
      broadcastGame(room, game);
      ack({ ok: true, data: null });
    } catch (err) {
      fail(ack, err);
    }
  });

  socket.on(ClientEvent.Restart, (_req: unknown, ack: (r: Ack<null>) => void) => {
    try {
      const token = (socket.data as SocketData).token;
      if (!token) throw new RoomError("expired", "Сессия истекла");
      const room = rooms.getRoomByToken(token);
      const member = room?.byToken(token);
      if (!room || !member) throw new RoomError("expired", "Сессия истекла");
      if (!member.isHost)
        throw new RoomError("not_host", "Только капитан может перезапустить");
      disposeGame(room.code);
      room.phase = "lobby";
      io.to(roomChannel(room)).emit(ServerEvent.RoomState, room.view());
      ack({ ok: true, data: null });
    } catch (err) {
      fail(ack, err);
    }
  });

  socket.on(
    ClientEvent.Intent,
    (intent: Intent, ack?: (r: Ack<IntentAck>) => void) => {
      const token = (socket.data as SocketData).token;
      const room = token ? rooms.getRoomByToken(token) : undefined;
      const member = room?.byToken(token!);
      const game = room ? games.get(room.code) : undefined;
      if (!room || !member || !game) {
        ack?.({ ok: false, error: "not_found", message: "Игра не найдена" });
        return;
      }
      const { changed, completed } = game.applyIntent(member.id, intent);
      if (changed) broadcastGame(room, game);
      ack?.({ ok: true, data: { completed } });
    },
  );

  socket.on("disconnect", () => {
    const token = (socket.data as SocketData).token;
    if (token) rooms.markDisconnected(token, socket.id);
  });
});

http.listen(PORT, HOST, () => {
  console.log(`overcrew server on http://${HOST}:${PORT}  (Socket.IO)`);
});
