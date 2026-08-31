/**
 * Room & lobby model (Stage 2).
 *
 * Rooms live only in server memory. Identity is a persistent `playerId` + a
 * secret `token` (never the socket id) so a dropped phone can reclaim its seat
 * within a grace window instead of the room being destroyed. See
 * docs/DECISIONS.md D3 / D4.
 */

export type RoomPhase = "lobby" | "playing" | "gameover";
export type ConnectionStatus = "connected" | "disconnected";

/** What every client is allowed to see about a player. No token, no socket id. */
export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  connection: ConnectionStatus;
}

/** The broadcast room state. Clients derive `youId` / `canStart` locally. */
export interface RoomView {
  code: string;
  phase: RoomPhase;
  players: PublicPlayer[];
  protocolVersion: number;
}

export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS = 8;

// --- Room codes ------------------------------------------------------------

export const ROOM_CODE_LENGTH = 4;
/** Uppercase, no vowels (A E I O U) and no ambiguous glyphs (0 1). Shout-friendly. */
export const ROOM_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ23456789";

export function generateRoomCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.floor(random() * ROOM_CODE_ALPHABET.length);
    out += ROOM_CODE_ALPHABET[idx] ?? ROOM_CODE_ALPHABET[0];
  }
  return out;
}

export function isValidRoomCode(code: string): boolean {
  return (
    code.length === ROOM_CODE_LENGTH &&
    [...code].every((c) => ROOM_CODE_ALPHABET.includes(c))
  );
}

/** Best-effort clean-up of user input before validation ("  bc df " → "BCDF"). */
export function normalizeRoomCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

// --- Nicknames ----------------------------------------------------------

export const MAX_NICKNAME_LENGTH = 16;
export const FALLBACK_NICKNAME = "Игрок";

export function normalizeNickname(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_NICKNAME_LENGTH);
}

/**
 * Space-themed default callsigns. The client offers one as a grey placeholder;
 * the player keeps it (submit with the field empty) or types their own.
 */
export const DEFAULT_NICKNAMES = [
  "Комета",
  "Пульсар",
  "Квазар",
  "Метеор",
  "Астероид",
  "Нейтрон",
  "Фотон",
  "Скафандр",
  "Реактор",
  "Гравитон",
] as const;

export function randomNickname(random: () => number = Math.random): string {
  const i = Math.floor(random() * DEFAULT_NICKNAMES.length);
  return DEFAULT_NICKNAMES[i] ?? DEFAULT_NICKNAMES[0];
}

// --- Derived lobby helpers -------------------------------------------

export function connectedCount(players: readonly PublicPlayer[]): number {
  return players.filter((p) => p.connection === "connected").length;
}

/** Only the host may start, only from the lobby, only with ≥ 2 connected players. */
export function canStart(
  view: Pick<RoomView, "phase" | "players">,
  meId: string,
): boolean {
  const me = view.players.find((p) => p.id === meId);
  return (
    me?.isHost === true &&
    view.phase === "lobby" &&
    connectedCount(view.players) >= MIN_PLAYERS_TO_START
  );
}
