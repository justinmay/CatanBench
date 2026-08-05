import {
  chooseFallbackAction,
  type EngineEvent,
  type EnginePlayerInput,
  type EngineState,
} from "@catanbench/engine";
import { describe, expect, it } from "vitest";

import { GameOrchestrator } from "./orchestrator";
import type {
  ClaimExpiredGamesInput,
  GameSession,
  OrchestrationStore,
  PersistedGameStatus,
  SaveStateInput,
  StoredGame,
  StoredTradeProposal,
} from "./types";
import { StoredGameNotFoundError } from "./types";

const PLAYERS: EnginePlayerInput[] = [
  { id: "player_a", seat: 0, name: "A", color: "red" },
  { id: "player_b", seat: 1, name: "B", color: "blue" },
  { id: "player_c", seat: 2, name: "C", color: "white" },
];
const START = new Date("2026-08-04T12:00:00.000Z");

interface History {
  snapshots: EngineState[];
  events: Array<{ version: number; event: EngineEvent }>;
  tradeProposals: StoredTradeProposal[];
}

class MemorySession implements GameSession {
  game: StoredGame;
  readonly history: History;

  constructor(game: StoredGame, history: History) {
    this.game = game;
    this.history = history;
  }

  async saveState(input: SaveStateInput): Promise<void> {
    const expectedVersion = this.game.stateVersion;
    if (
      input.previousState === null
        ? this.game.state !== null || input.state.version !== expectedVersion
        : this.game.state === null ||
          input.previousState.version !== expectedVersion ||
          input.state.version !== expectedVersion + 1
    ) {
      throw new Error("Invalid memory-store transition version");
    }

    const state = structuredClone(input.state);
    this.history.snapshots.push(state);
    this.history.events.push(
      ...input.events.map((event) => ({
        version: state.version,
        event: structuredClone(event),
      })),
    );
    this.game = {
      ...this.game,
      status: state.status,
      stateVersion: state.version,
      turnStartedAt: input.turnStartedAt,
      turnDeadlineAt: input.turnDeadlineAt,
      state,
    };
  }

  async saveStatus(status: PersistedGameStatus): Promise<void> {
    this.game = {
      ...this.game,
      status,
      turnStartedAt: null,
      turnDeadlineAt: null,
      deadlineClaimedBy: null,
      deadlineClaimedUntil: null,
    };
  }

  async saveTradeProposal(proposal: StoredTradeProposal): Promise<void> {
    this.history.tradeProposals.push(structuredClone(proposal));
  }

  async releaseDeadlineClaim(workerId: string): Promise<boolean> {
    if (this.game.deadlineClaimedBy !== workerId) {
      return false;
    }
    this.game = {
      ...this.game,
      deadlineClaimedBy: null,
      deadlineClaimedUntil: null,
    };
    return true;
  }
}

class MemoryStore implements OrchestrationStore {
  readonly #games = new Map<string, StoredGame>();
  readonly #histories = new Map<string, History>();
  readonly #lockTails = new Map<string, Promise<void>>();

  addLobby(id: string, turnTimeoutSeconds = 20): void {
    this.#games.set(id, {
      id,
      status: "lobby",
      stateVersion: 0,
      turnTimeoutSeconds,
      victoryPointsToWin: 10,
      playerLimit: PLAYERS.length,
      seed: `seed_${id}`,
      turnStartedAt: null,
      turnDeadlineAt: null,
      deadlineClaimedBy: null,
      deadlineClaimedUntil: null,
      players: structuredClone(PLAYERS),
      state: null,
    });
    this.#histories.set(id, { snapshots: [], events: [], tradeProposals: [] });
  }

  get(id: string): StoredGame {
    const game = this.#games.get(id);
    if (!game) {
      throw new Error(`Missing test game: ${id}`);
    }
    return structuredClone(game);
  }

  history(id: string): History {
    return structuredClone(this.#histories.get(id)!);
  }

  mutateState(id: string, mutate: (state: EngineState) => void): void {
    const game = this.#games.get(id);
    if (!game?.state) {
      throw new Error(`Missing test state: ${id}`);
    }
    mutate(game.state);
    game.status = game.state.status;
    game.stateVersion = game.state.version;
  }

  async withGameLock<T>(
    gameId: string,
    operation: (session: GameSession) => Promise<T>,
  ): Promise<T> {
    const previous = this.#lockTails.get(gameId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#lockTails.set(
      gameId,
      previous.then(() => current),
    );
    await previous;

    try {
      const stored = this.#games.get(gameId);
      if (!stored) {
        throw new StoredGameNotFoundError(gameId);
      }
      const session = new MemorySession(structuredClone(stored), {
        snapshots: [],
        events: [],
        tradeProposals: [],
      });
      const result = await operation(session);
      this.#games.set(gameId, structuredClone(session.game));
      const history = this.#histories.get(gameId)!;
      history.snapshots.push(...session.history.snapshots);
      history.events.push(...session.history.events);
      history.tradeProposals.push(...session.history.tradeProposals);
      return result;
    } finally {
      release();
    }
  }

  async claimExpiredGames(input: ClaimExpiredGamesInput): Promise<string[]> {
    const claimed: string[] = [];
    const candidates = [...this.#games.values()]
      .filter(
        (game) =>
          (game.status === "initial_placement" || game.status === "active") &&
          game.turnDeadlineAt !== null &&
          game.turnDeadlineAt <= input.now &&
          (game.deadlineClaimedUntil === null ||
            game.deadlineClaimedUntil <= input.now),
      )
      .sort((left, right) =>
        left.turnDeadlineAt!.getTime() === right.turnDeadlineAt!.getTime()
          ? left.id.localeCompare(right.id)
          : left.turnDeadlineAt!.getTime() - right.turnDeadlineAt!.getTime(),
      );

    for (const game of candidates.slice(0, input.limit)) {
      game.deadlineClaimedBy = input.workerId;
      game.deadlineClaimedUntil = input.leaseUntil;
      claimed.push(game.id);
    }
    return claimed;
  }
}

function dueAt(game: StoredGame): Date {
  if (!game.turnDeadlineAt) {
    throw new Error("Test game has no deadline");
  }
  return game.turnDeadlineAt;
}

describe("game orchestration", () => {
  it("starts a full lobby with a durable initial deadline", async () => {
    const store = new MemoryStore();
    store.addLobby("game_start");
    const orchestrator = new GameOrchestrator(store, () => START);

    const state = await orchestrator.startGame("game_start");
    const stored = store.get("game_start");

    expect(state.status).toBe("initial_placement");
    expect(stored.stateVersion).toBe(0);
    expect(stored.turnStartedAt).toEqual(START);
    expect(stored.turnDeadlineAt).toEqual(new Date("2026-08-04T12:00:20.000Z"));
    expect(store.history("game_start").snapshots).toHaveLength(1);
    expect(store.history("game_start").events[0]?.event.type).toBe(
      "gameStarted",
    );
  });

  it("serializes concurrent commands and rejects the stale loser", async () => {
    const store = new MemoryStore();
    store.addLobby("game_race");
    const orchestrator = new GameOrchestrator(store, () => START);
    const initial = await orchestrator.startGame("game_race");
    const action = chooseFallbackAction(initial, "player_a")!;

    const outcomes = await Promise.allSettled([
      orchestrator.submitAction({
        gameId: "game_race",
        playerId: "player_a",
        expectedVersion: 0,
        action,
      }),
      orchestrator.submitAction({
        gameId: "game_race",
        playerId: "player_a",
        expectedVersion: 0,
        action,
      }),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(
      rejected?.status === "rejected" ? rejected.reason : null,
    ).toMatchObject({ code: "stale_state" });
    expect(store.get("game_race").stateVersion).toBe(1);
  });

  it("preserves a deadline within a turn and refreshes it at the boundary", async () => {
    const store = new MemoryStore();
    store.addLobby("game_timing");
    const orchestrator = new GameOrchestrator(store, () => START);
    const initial = await orchestrator.startGame("game_timing");
    const initialDeadline = dueAt(store.get("game_timing"));
    const settlement = chooseFallbackAction(initial, "player_a")!;

    const afterSettlement = await orchestrator.submitAction({
      gameId: "game_timing",
      playerId: "player_a",
      expectedVersion: 0,
      action: settlement,
      now: new Date(START.getTime() + 1_000),
    });
    expect(store.get("game_timing").turnDeadlineAt).toEqual(initialDeadline);

    const road = chooseFallbackAction(afterSettlement.state, "player_a")!;
    await orchestrator.submitAction({
      gameId: "game_timing",
      playerId: "player_a",
      expectedVersion: 1,
      action: road,
      now: new Date(START.getTime() + 2_000),
    });
    expect(store.get("game_timing").turnDeadlineAt).toEqual(
      new Date(START.getTime() + 22_000),
    );
  });

  it("advances an expired turn before rejecting a late command", async () => {
    const store = new MemoryStore();
    store.addLobby("game_late");
    const orchestrator = new GameOrchestrator(store, () => START);
    const initial = await orchestrator.startGame("game_late");
    const lateAction = chooseFallbackAction(initial, "player_a")!;
    const deadline = dueAt(store.get("game_late"));

    await expect(
      orchestrator.submitAction({
        gameId: "game_late",
        playerId: "player_a",
        expectedVersion: 0,
        action: lateAction,
        now: deadline,
      }),
    ).rejects.toMatchObject({ code: "stale_state" });

    const stored = store.get("game_late");
    expect(stored.stateVersion).toBe(2);
    expect(stored.state?.turn.activePlayerId).toBe("player_b");
    expect(stored.turnDeadlineAt).toEqual(
      new Date(deadline.getTime() + 20_000),
    );
    expect(
      store
        .history("game_late")
        .events.filter((item) => item.event.type === "deadlineActionApplied"),
    ).toHaveLength(2);
  });

  it("creates a durable player trade proposal and increments the version", async () => {
    const store = new MemoryStore();
    store.addLobby("game_trade");
    const orchestrator = new GameOrchestrator(store, () => START);
    await orchestrator.startGame("game_trade");
    store.mutateState("game_trade", (state) => {
      state.status = "active";
      state.turnNumber = 1;
      state.turn.phase = "main";
      state.turn.activePlayerId = "player_a";
      state.turn.requiredActorPlayerIds = ["player_a"];
      state.players[0]!.resources.brick = 1;
      state.players[1]!.resources.ore = 1;
    });

    const result = await orchestrator.createPlayerTradeProposal({
      gameId: "game_trade",
      proposalId: "trade_1",
      fromPlayerId: "player_a",
      toPlayerId: "player_b",
      expectedVersion: 0,
      offering: { brick: 1, lumber: 0, ore: 0, grain: 0, wool: 0 },
      requesting: { brick: 0, lumber: 0, ore: 1, grain: 0, wool: 0 },
      now: new Date(START.getTime() + 1_000),
    });

    expect(result.state.version).toBe(1);
    expect(result.events[0]?.type).toBe("tradeProposed");
    expect(store.history("game_trade").tradeProposals).toMatchObject([
      {
        id: "trade_1",
        createdAtVersion: 1,
        fromPlayerId: "player_a",
        toPlayerId: "player_b",
      },
    ]);
  });

  it("leases each expired game to only one competing worker", async () => {
    const store = new MemoryStore();
    store.addLobby("game_worker_a");
    store.addLobby("game_worker_b");
    const first = new GameOrchestrator(store, () => START);
    const second = new GameOrchestrator(store, () => START);
    await first.startGame("game_worker_a");
    await first.startGame("game_worker_b");
    const now = dueAt(store.get("game_worker_a"));

    const results = await Promise.all([
      first.claimAndAdvanceExpired({ workerId: "worker_a", now }),
      second.claimAndAdvanceExpired({ workerId: "worker_b", now }),
    ]);
    const claimed = results.flatMap((result) => result.claimedGameIds);

    expect(new Set(claimed)).toEqual(
      new Set(["game_worker_a", "game_worker_b"]),
    );
    expect(claimed).toHaveLength(2);
    expect(
      results.reduce((total, result) => total + result.advancedActionCount, 0),
    ).toBe(4);
    expect(store.get("game_worker_a").deadlineClaimedBy).toBeNull();
    expect(store.get("game_worker_b").deadlineClaimedBy).toBeNull();
  });

  it("automatically completes setup and a full normal turn", async () => {
    const store = new MemoryStore();
    store.addLobby("game_auto_turn");
    const orchestrator = new GameOrchestrator(store, () => START);
    await orchestrator.startGame("game_auto_turn");

    for (let setupTurn = 0; setupTurn < 6; setupTurn += 1) {
      const now = dueAt(store.get("game_auto_turn"));
      const batch = await orchestrator.claimAndAdvanceExpired({
        workerId: "worker_setup",
        now,
      });
      expect(batch.advancedActionCount).toBe(2);
    }

    const ready = store.get("game_auto_turn");
    expect(ready.state?.status).toBe("active");
    expect(ready.state?.turnNumber).toBe(1);
    expect(ready.state?.turn.activePlayerId).toBe("player_a");

    const batch = await orchestrator.claimAndAdvanceExpired({
      workerId: "worker_turn",
      now: dueAt(ready),
    });
    const advanced = store.get("game_auto_turn");
    expect(batch.advancedActionCount).toBeGreaterThanOrEqual(2);
    expect(advanced.state?.turnNumber).toBe(2);
    expect(advanced.state?.turn.activePlayerId).toBe("player_b");
    expect(advanced.turnDeadlineAt!.getTime()).toBeGreaterThan(
      dueAt(ready).getTime(),
    );
  });

  it("pauses, resumes with a fresh deadline, and stops a game", async () => {
    const store = new MemoryStore();
    store.addLobby("game_lifecycle");
    const orchestrator = new GameOrchestrator(store, () => START);
    await orchestrator.startGame("game_lifecycle");

    const paused = await orchestrator.pauseGame({
      gameId: "game_lifecycle",
      expectedVersion: 0,
      now: new Date(START.getTime() + 1_000),
    });
    expect(paused.status).toBe("paused");
    expect(store.get("game_lifecycle").turnDeadlineAt).toBeNull();

    const resumedAt = new Date(START.getTime() + 5_000);
    const resumed = await orchestrator.resumeGame({
      gameId: "game_lifecycle",
      expectedVersion: 1,
      now: resumedAt,
    });
    expect(resumed.status).toBe("initial_placement");
    expect(store.get("game_lifecycle").turnDeadlineAt).toEqual(
      new Date(resumedAt.getTime() + 20_000),
    );

    const stopped = await orchestrator.stopGame({
      gameId: "game_lifecycle",
      expectedVersion: 2,
      now: new Date(START.getTime() + 6_000),
    });
    expect(stopped?.status).toBe("stopped");
    expect(store.get("game_lifecycle").turnDeadlineAt).toBeNull();
  });

  it("can stop a lobby before it has an engine snapshot", async () => {
    const store = new MemoryStore();
    store.addLobby("game_lobby_stop");
    const orchestrator = new GameOrchestrator(store, () => START);

    expect(
      await orchestrator.stopGame({
        gameId: "game_lobby_stop",
        expectedVersion: 0,
      }),
    ).toBeNull();
    expect(store.get("game_lobby_stop").status).toBe("stopped");
  });
});
