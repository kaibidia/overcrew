import type { Session } from "@overcrew/shared";

const KEY = "overcrew.session";

/** Persisted so a reload / reconnect can reclaim the same seat. */
export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<Session>;
    if (
      typeof s.playerId === "string" &&
      typeof s.token === "string" &&
      typeof s.roomCode === "string"
    ) {
      return { playerId: s.playerId, token: s.token, roomCode: s.roomCode };
    }
  } catch {
    /* private mode / corrupt value — treat as no session */
  }
  return null;
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* best effort */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* best effort */
  }
}
