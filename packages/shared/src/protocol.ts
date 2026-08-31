/**
 * Wire protocol between web client and game server.
 *
 * Every server→client payload carries `PROTOCOL_VERSION`; on mismatch the client
 * asks the user to refresh rather than misbehaving (docs/ARCHITECTURE.md §5,
 * DECISIONS D6). Client→server calls use Socket.IO ack callbacks typed as `Ack<T>`.
 */
import type { RoomView } from "./room";

export const PROTOCOL_VERSION = 1;

/** Stored client-side (localStorage) so a reconnecting phone reclaims its seat. */
export interface Session {
  playerId: string;
  token: string;
  roomCode: string;
}

export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: AckError; message: string };

export type AckError =
  | "bad_request"
  | "not_found"
  | "in_progress"
  | "full"
  | "nickname_taken"
  | "expired"
  | "not_host"
  | "not_ready";

export interface CreateRoomReq {
  nickname: string;
}
export interface JoinRoomReq {
  code: string;
  nickname: string;
}
export interface ResumeReq {
  token: string;
}
/** Reply to create / join / resume. */
export interface RoomJoinedData {
  session: Session;
  view: RoomView;
}

/** Client → server event names (all take an `Ack` callback). */
export const ClientEvent = {
  CreateRoom: "room:create",
  JoinRoom: "room:join",
  Resume: "room:resume",
  Leave: "room:leave",
  Start: "room:start",
  /** Stage 3: player intent — `Intent` payload (game.ts). */
  Intent: "game:intent",
} as const;

/** Server → client event names. */
export const ServerEvent = {
  RoomState: "room:state",
  /** Stage 3: this player's filtered `PlayerView` (game.ts). */
  PlayerView: "game:view",
} as const;

/** Ack reply to `game:intent`. */
export interface IntentAck {
  completed: boolean;
}
