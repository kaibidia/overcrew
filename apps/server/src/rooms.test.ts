import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { RoomManager, RoomError, type Room } from "./rooms";

let changed: Room[] = [];
const mgr = () =>
  new RoomManager({
    graceMs: 1000,
    onChange: (room) => changed.push(room),
  });

beforeEach(() => {
  changed = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("create & join", () => {
  it("creates a room with the creator as sole host", () => {
    const m = mgr();
    const { room, member } = m.createRoom("Капитан");
    expect(room.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(member.isHost).toBe(true);
    expect(member.nickname).toBe("Капитан");
    expect(room.view().players).toHaveLength(1);
  });

  it("falls back to a default nickname when blank", () => {
    const { member } = mgr().createRoom("   ");
    expect(member.nickname).toBe("Игрок");
  });

  it("lets others join by code; second player is not host", () => {
    const m = mgr();
    const { room } = m.createRoom("A");
    const { member: b } = m.joinRoom(room.code, "B");
    expect(b.isHost).toBe(false);
    expect(room.view().players.map((p) => p.nickname)).toEqual(["A", "B"]);
  });

  it("rejects an unknown code", () => {
    expect(() => mgr().joinRoom("ZZZZ", "x")).toThrow(RoomError);
  });

  it("rejects joining once the game is playing", () => {
    const m = mgr();
    const { room, member: host } = m.createRoom("A");
    m.joinRoom(room.code, "B"); // both connected by default
    m.startGame(host.token);
    expect(() => m.joinRoom(room.code, "C")).toThrow(/идёт/);
  });

  it("rejects a nickname already used in the room (case-insensitive)", () => {
    const m = mgr();
    const { room } = m.createRoom("Метеор");
    expect(() => m.joinRoom(room.code, "Метеор")).toThrow(/занят/);
    expect(() => m.joinRoom(room.code, "  метеор ")).toThrow(/занят/);
    expect(() => m.joinRoom(room.code, "Комета")).not.toThrow();
  });

  it("still blocks a nickname held by a disconnected (in-grace) member", () => {
    const m = mgr();
    const { room, member } = m.createRoom("Host");
    const { member: b } = m.joinRoom(room.code, "Метеор");
    m.attach(b.token, "s1");
    m.markDisconnected(b.token, "s1");
    expect(() => m.joinRoom(room.code, "Метеор")).toThrow(/занят/);
  });
});

describe("start rules", () => {
  it("only the host may start, and only with ≥ 2 players", () => {
    const m = mgr();
    const { room, member: host } = m.createRoom("A");
    expect(() => m.startGame(host.token)).toThrow(/2 игрока/);
    const { member: b } = m.joinRoom(room.code, "B");
    expect(() => m.startGame(b.token)).toThrow(/капитан/);
    m.startGame(host.token);
    expect(room.phase).toBe("playing");
  });
});

describe("disconnect grace & reconnect", () => {
  it("keeps the seat and the room alive during the grace window", () => {
    const m = mgr();
    const { room, member } = m.createRoom("A");
    m.joinRoom(room.code, "B");
    m.attach(member.token, "s1");

    m.markDisconnected(member.token, "s1");
    expect(room.view().players[0]!.connection).toBe("disconnected");
    expect(m.roomCount).toBe(1);

    vi.advanceTimersByTime(500);
    const resumed = m.resume(member.token);
    expect(resumed.member.connected).toBe(true);
    expect(room.view().players[0]!.connection).toBe("connected");

    vi.advanceTimersByTime(5000); // old timer must have been cancelled
    expect(room.view().players[0]!.connection).toBe("connected");
    expect(m.roomCount).toBe(1);
  });

  it("drops the seat after the grace window expires", () => {
    const m = mgr();
    const { room, member } = m.createRoom("A");
    m.joinRoom(room.code, "B");
    m.attach(member.token, "s1");

    m.markDisconnected(member.token, "s1");
    vi.advanceTimersByTime(1000);

    expect(room.view().players).toHaveLength(1);
    expect(() => m.resume(member.token)).toThrow(/истекла/);
  });

  it("promotes a new host when the host's seat is dropped", () => {
    const m = mgr();
    const { room, member: host } = m.createRoom("A");
    const { member: b } = m.joinRoom(room.code, "B");
    m.attach(host.token, "s1");

    m.markDisconnected(host.token, "s1");
    vi.advanceTimersByTime(1000);

    const players = room.view().players;
    expect(players).toHaveLength(1);
    expect(players[0]!.nickname).toBe("B");
    expect(players[0]!.isHost).toBe(true);
    expect(b.isHost).toBe(true);
  });

  it("disposes the room once the last player is gone", () => {
    const m = mgr();
    const { member } = m.createRoom("A");
    m.attach(member.token, "s1");
    m.leave(member.token);
    expect(m.roomCount).toBe(0);
  });

  it("ignores a stale socket's disconnect after the seat was rebound", () => {
    const m = mgr();
    const { room, member } = m.createRoom("A");
    m.joinRoom(room.code, "B");
    m.attach(member.token, "s1");
    m.attach(member.token, "s2"); // reconnected on a new socket

    m.markDisconnected(member.token, "s1"); // the old socket finally times out
    expect(room.view().players[0]!.connection).toBe("connected");
  });
});
