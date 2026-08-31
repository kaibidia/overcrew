import { randomUUID } from "node:crypto";
import {
  FALLBACK_NICKNAME,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  PROTOCOL_VERSION,
  connectedCount,
  generateRoomCode,
  normalizeNickname,
  type AckError,
  type PublicPlayer,
  type RoomPhase,
  type RoomView,
} from "@overcrew/shared";

/** Seat kept open this long after a disconnect before the player is dropped. */
export const GRACE_MS = 60_000;

export class RoomError extends Error {
  constructor(
    readonly code: AckError,
    message: string,
  ) {
    super(message);
    this.name = "RoomError";
  }
}

export interface Member {
  id: string;
  nickname: string;
  token: string;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;
  /** id of the socket that currently owns this seat, if any. */
  socketId?: string;
  graceTimer?: ReturnType<typeof setTimeout>;
}

function toPublic(m: Member): PublicPlayer {
  return {
    id: m.id,
    nickname: m.nickname,
    isHost: m.isHost,
    connection: m.connected ? "connected" : "disconnected",
  };
}

export class Room {
  phase: RoomPhase = "lobby";
  readonly members: Member[] = [];

  constructor(readonly code: string) {}

  view(): RoomView {
    return {
      code: this.code,
      phase: this.phase,
      players: this.members.map(toPublic),
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  byToken(token: string): Member | undefined {
    return this.members.find((m) => m.token === token);
  }

  /** Ensure exactly one host exists; promote the earliest joiner if the host left. */
  ensureHost(): void {
    if (this.members.length === 0) return;
    if (this.members.some((m) => m.isHost)) return;
    const ordered = [...this.members].sort((a, b) => a.joinedAt - b.joinedAt);
    const next =
      ordered.find((m) => m.connected) ?? (ordered[0] as Member);
    next.isHost = true;
  }
}

export interface RoomManagerOptions {
  now?: () => number;
  graceMs?: number;
  /** Called with the affected room whenever its view changes. */
  onChange: (room: Room) => void;
  /** Called with the code of a room that was just disposed (now empty). */
  onDispose?: (code: string) => void;
  /** Called when a member is removed from a still-alive room (left / grace expired). */
  onMemberDropped?: (room: Room, playerId: string) => void;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly tokenToCode = new Map<string, string>();
  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly onChange: (room: Room) => void;
  private readonly onDispose: (code: string) => void;
  private readonly onMemberDropped: (room: Room, playerId: string) => void;

  constructor(opts: RoomManagerOptions) {
    this.now = opts.now ?? Date.now;
    this.graceMs = opts.graceMs ?? GRACE_MS;
    this.onChange = opts.onChange;
    this.onDispose = opts.onDispose ?? (() => undefined);
    this.onMemberDropped = opts.onMemberDropped ?? (() => undefined);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoomByToken(token: string): Room | undefined {
    const code = this.tokenToCode.get(token);
    return code ? this.rooms.get(code) : undefined;
  }

  createRoom(nickname: string): { room: Room; member: Member } {
    const room = new Room(this.freshCode());
    this.rooms.set(room.code, room);
    const member = this.addMember(room, nickname, true);
    return { room, member };
  }

  joinRoom(code: string, nickname: string): { room: Room; member: Member } {
    const room = this.rooms.get(code);
    if (!room) throw new RoomError("not_found", "Комната не найдена");
    if (room.phase !== "lobby")
      throw new RoomError("in_progress", "Игра уже идёт");
    if (room.members.length >= MAX_PLAYERS)
      throw new RoomError("full", "Комната заполнена");

    // Players coordinate by shouting names — no two seats (even a disconnected
    // one still in its grace window) may share a visible nickname.
    const clean = normalizeNickname(nickname) || FALLBACK_NICKNAME;
    if (
      room.members.some(
        (m) => m.nickname.toLowerCase() === clean.toLowerCase(),
      )
    ) {
      throw new RoomError(
        "nickname_taken",
        `Позывной «${clean}» уже занят в этой комнате`,
      );
    }

    const member = this.addMember(room, clean, room.members.length === 0);
    return { room, member };
  }

  /** Reclaim a seat after a reconnect. */
  resume(token: string): { room: Room; member: Member } {
    const room = this.getRoomByToken(token);
    const member = room?.byToken(token);
    if (!room || !member)
      throw new RoomError("expired", "Сессия истекла");
    this.clearGrace(member);
    member.connected = true;
    this.onChange(room);
    return { room, member };
  }

  /** Bind a socket to a seat (create/join/resume). */
  attach(token: string, socketId: string): void {
    const member = this.getRoomByToken(token)?.byToken(token);
    if (member) member.socketId = socketId;
  }

  /** A socket dropped. Start the grace timer only if it still owns the seat. */
  markDisconnected(token: string, socketId: string): void {
    const room = this.getRoomByToken(token);
    const member = room?.byToken(token);
    if (!room || !member || member.socketId !== socketId) return;
    member.connected = false;
    member.socketId = undefined;
    this.clearGrace(member);
    member.graceTimer = setTimeout(() => {
      this.dropMember(room, member);
    }, this.graceMs);
    this.onChange(room);
  }

  /** Player deliberately left. */
  leave(token: string): void {
    const room = this.getRoomByToken(token);
    const member = room?.byToken(token);
    if (!room || !member) return;
    this.dropMember(room, member);
  }

  startGame(token: string): Room {
    const room = this.getRoomByToken(token);
    const member = room?.byToken(token);
    if (!room || !member) throw new RoomError("expired", "Сессия истекла");
    if (!member.isHost)
      throw new RoomError("not_host", "Только капитан может начать");
    if (room.phase !== "lobby")
      throw new RoomError("in_progress", "Игра уже идёт");
    if (connectedCount(room.view().players) < MIN_PLAYERS_TO_START)
      throw new RoomError("not_ready", "Нужно минимум 2 игрока");
    room.phase = "playing";
    this.onChange(room);
    return room;
  }

  // --- internals ---------------------------------------------------------

  private addMember(room: Room, nickname: string, isHost: boolean): Member {
    const member: Member = {
      id: randomUUID(),
      nickname: normalizeNickname(nickname) || FALLBACK_NICKNAME,
      token: randomUUID(),
      isHost,
      connected: true,
      joinedAt: this.now(),
    };
    room.members.push(member);
    this.tokenToCode.set(member.token, room.code);
    this.onChange(room);
    return member;
  }

  private dropMember(room: Room, member: Member): void {
    this.clearGrace(member);
    const idx = room.members.indexOf(member);
    if (idx === -1) return;
    room.members.splice(idx, 1);
    this.tokenToCode.delete(member.token);

    if (room.members.length === 0) {
      this.rooms.delete(room.code);
      this.onDispose(room.code);
      return;
    }
    if (member.isHost) room.ensureHost();
    this.onMemberDropped(room, member.id);
    this.onChange(room);
  }

  private clearGrace(member: Member): void {
    if (member.graceTimer) {
      clearTimeout(member.graceTimer);
      member.graceTimer = undefined;
    }
  }

  private freshCode(): string {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    return code;
  }
}
