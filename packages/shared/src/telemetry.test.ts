import { describe, it, expect } from "vitest";
import { buildScoreboard, type TelemetryEvent } from "./telemetry";

const GAME = "g1";

function created(
  id: string,
  overrides: Partial<Extract<TelemetryEvent, { type: "instruction_created" }>> = {},
): Extract<TelemetryEvent, { type: "instruction_created" }> {
  return {
    type: "instruction_created",
    gameId: GAME,
    at: 0,
    instructionId: id,
    sequence: 1,
    sourcePlayerId: "A",
    targetPlayerId: "B",
    targetControlId: `c_${id}`,
    targetControlLabel: "ГИРОСКОП",
    instructionType: "press",
    text: "ГИРОСКОП → НАЖАТЬ",
    deadlineAt: 10_000,
    ...overrides,
  };
}

function started(playerIds: string[]): TelemetryEvent {
  return {
    type: "session_started",
    gameId: GAME,
    at: 0,
    seed: "seed",
    playerIds,
    difficulty: { deadlineMs: 10_000, instructionsPerPlayer: 1, expirePenalty: 8, completeHeal: 4 },
  };
}

describe("buildScoreboard", () => {
  it("seeds every session player even with zero events", () => {
    const board = buildScoreboard([started(["A", "B"])]);
    expect(board.players.map((p) => p.playerId).sort()).toEqual(["A", "B"]);
    for (const p of board.players) {
      expect(p.transmitted).toBe(0);
      expect(p.executed).toBe(0);
      expect(p.failed).toBe(0);
      expect(p.avgExecutionMs).toBeNull();
      expect(p.causedCrash).toBe(false);
    }
  });

  it("counts a successfully transmitted, then executed instruction under the right roles", () => {
    const events: TelemetryEvent[] = [
      started(["A", "B"]),
      created("i1"), // source A, target B
      { type: "instruction_transmitted", gameId: GAME, at: 100, instructionId: "i1", success: true },
      { type: "instruction_resolved", gameId: GAME, at: 1_100, instructionId: "i1", status: "executed", durationMs: 1_000 },
    ];
    const board = buildScoreboard(events);
    const a = board.players.find((p) => p.playerId === "A")!;
    const b = board.players.find((p) => p.playerId === "B")!;
    // Communication contribution (source) is separate from execution (target).
    expect(a.transmitted).toBe(1);
    expect(a.executed).toBe(0);
    expect(b.transmitted).toBe(0);
    expect(b.executed).toBe(1);
    expect(b.avgExecutionMs).toBe(1_000);
  });

  it("counts an expired instruction as a failure for the target (control owner), not the source", () => {
    const events: TelemetryEvent[] = [
      started(["A", "B"]),
      created("i1"),
      { type: "instruction_transmitted", gameId: GAME, at: 100, instructionId: "i1", success: true },
      { type: "instruction_resolved", gameId: GAME, at: 10_000, instructionId: "i1", status: "expired" },
    ];
    const board = buildScoreboard(events);
    expect(board.players.find((p) => p.playerId === "B")!.failed).toBe(1);
    expect(board.players.find((p) => p.playerId === "A")!.failed).toBe(0);
  });

  it("does not count an unsuccessful transmission toward the source's transmitted total", () => {
    const events: TelemetryEvent[] = [
      started(["A", "B"]),
      created("i1"),
      { type: "instruction_transmitted", gameId: GAME, at: 100, instructionId: "i1", success: false, failureReason: "recipient_never_connected" },
      { type: "instruction_resolved", gameId: GAME, at: 10_000, instructionId: "i1", status: "expired" },
    ];
    const board = buildScoreboard(events);
    expect(board.players.find((p) => p.playerId === "A")!.transmitted).toBe(0);
  });

  it("a cancelled instruction (player left) counts toward nothing — not a failure", () => {
    const events: TelemetryEvent[] = [
      started(["A", "B"]),
      created("i1"),
      { type: "instruction_transmitted", gameId: GAME, at: 100, instructionId: "i1", success: true },
      { type: "instruction_resolved", gameId: GAME, at: 5_000, instructionId: "i1", status: "cancelled" },
    ];
    const board = buildScoreboard(events);
    expect(board.players.find((p) => p.playerId === "B")!.failed).toBe(0);
    expect(board.players.find((p) => p.playerId === "B")!.executed).toBe(0);
  });

  it("averages execution time over only that player's own successful executions", () => {
    const events: TelemetryEvent[] = [
      started(["A", "B"]),
      created("i1", { sequence: 1 }),
      created("i2", { sequence: 2, targetControlId: "c2" }),
      { type: "instruction_resolved", gameId: GAME, at: 1_000, instructionId: "i1", status: "executed", durationMs: 1_000 },
      { type: "instruction_resolved", gameId: GAME, at: 4_000, instructionId: "i2", status: "executed", durationMs: 3_000 },
    ];
    const board = buildScoreboard(events);
    expect(board.players.find((p) => p.playerId === "B")!.avgExecutionMs).toBe(2_000);
  });

  it("attributes crash causality to the actual instruction and control owner, not the worst offender", () => {
    const events: TelemetryEvent[] = [
      started(["A", "B", "C"]),
      created("i1", { sourcePlayerId: "A", targetPlayerId: "B", targetControlLabel: "ГИРОСКОП", text: "ГИРОСКОП → ВВЕРХ" }),
      { type: "instruction_resolved", gameId: GAME, at: 10_000, instructionId: "i1", status: "expired" },
      {
        type: "crash",
        gameId: GAME,
        at: 10_000,
        reason: "health",
        causedByInstructionId: "i1",
        responsiblePlayerId: "B",
        sourcePlayerId: "A",
        targetControlId: "c_i1",
        healthAtCrash: 0,
      },
    ];
    const board = buildScoreboard(events);
    expect(board.crash?.reason).toBe("health");
    expect(board.crash?.responsiblePlayerId).toBe("B");
    expect(board.crash?.instructionText).toBe("ГИРОСКОП → ВВЕРХ");
    expect(board.players.find((p) => p.playerId === "B")!.causedCrash).toBe(true);
    expect(board.players.find((p) => p.playerId === "A")!.causedCrash).toBe(false);
    expect(board.players.find((p) => p.playerId === "C")!.causedCrash).toBe(false);
  });

  it("does not fabricate a crash or a responsible player when the crew simply fell apart", () => {
    const events: TelemetryEvent[] = [
      started(["A", "B"]),
      { type: "crash", gameId: GAME, at: 5_000, reason: "crew", healthAtCrash: 40 },
    ];
    const board = buildScoreboard(events);
    expect(board.crash?.reason).toBe("crew");
    expect(board.crash?.responsiblePlayerId).toBeUndefined();
    expect(board.crash?.instructionId).toBeUndefined();
    expect(board.players.every((p) => !p.causedCrash)).toBe(true);
  });

  it("a session with no crash event at all reports no crash", () => {
    const board = buildScoreboard([started(["A", "B"])]);
    expect(board.crash).toBeUndefined();
  });
});
