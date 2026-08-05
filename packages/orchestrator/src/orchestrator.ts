import {
  applyAction,
  applyPlayerTrade,
  chooseFallbackAction,
  createGame,
  type EngineEvent,
  type EngineResult,
  type EngineState,
  RulesError,
} from "@catanbench/engine";

import type {
  DeadlineBatchInput,
  DeadlineBatchResult,
  ExecutePlayerTradeInput,
  GameSession,
  LifecycleCommandInput,
  OrchestrationStore,
  SubmitActionInput,
} from "./types";
import { OrchestrationError, StoredGameNotFoundError } from "./types";

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_LEASE_DURATION_MS = 10_000;
const MAX_FALLBACK_ACTIONS_PER_DEADLINE = 16;

function isRunningStatus(status: EngineState["status"]): boolean {
  return status === "initial_placement" || status === "active";
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}

function isDeadlineDue(session: GameSession, now: Date): boolean {
  return (
    session.game.state !== null &&
    isRunningStatus(session.game.state.status) &&
    session.game.turnDeadlineAt !== null &&
    session.game.turnDeadlineAt.getTime() <= now.getTime()
  );
}

function assertExpectedVersion(
  session: GameSession,
  expectedVersion: number,
): void {
  if (session.game.stateVersion !== expectedVersion) {
    throw new OrchestrationError(
      "stale_state",
      `Expected game version ${expectedVersion}, but the current version is ${session.game.stateVersion}.`,
      {
        expectedVersion,
        currentVersion: session.game.stateVersion,
      },
    );
  }
}

function requireState(session: GameSession): EngineState {
  if (session.game.state === null) {
    throw new OrchestrationError(
      "invalid_game_status",
      "The game has not been started",
      { status: session.game.status },
    );
  }
  return session.game.state;
}

function lifecycleEvent(
  type: string,
  data: Record<string, unknown>,
): EngineEvent {
  return {
    type,
    actorPlayerId: null,
    visibility: "public",
    data,
  };
}

function mapRulesError(error: unknown): never {
  if (error instanceof RulesError) {
    const code =
      error.code === "invalid_state" ? "invalid_snapshot" : error.code;
    throw new OrchestrationError(code, error.message);
  }
  throw error;
}

export class GameOrchestrator {
  readonly #store: OrchestrationStore;
  readonly #now: () => Date;

  constructor(store: OrchestrationStore, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#now = now;
  }

  async #withGame<T>(
    gameId: string,
    operation: (session: GameSession) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.#store.withGameLock(gameId, operation);
    } catch (error) {
      if (error instanceof StoredGameNotFoundError) {
        throw new OrchestrationError("game_not_found", error.message, {
          gameId,
        });
      }
      throw error;
    }
  }

  #timingForTransition(
    session: GameSession,
    previousState: EngineState | null,
    nextState: EngineState,
    now: Date,
    forceFreshDeadline = false,
  ): { turnStartedAt: Date | null; turnDeadlineAt: Date | null } {
    if (!isRunningStatus(nextState.status)) {
      return { turnStartedAt: null, turnDeadlineAt: null };
    }

    const turnBoundaryChanged =
      previousState === null ||
      previousState.turn.activePlayerId !== nextState.turn.activePlayerId ||
      previousState.turnNumber !== nextState.turnNumber ||
      previousState.turn.initialPlacementIndex !==
        nextState.turn.initialPlacementIndex;
    if (
      forceFreshDeadline ||
      turnBoundaryChanged ||
      session.game.turnStartedAt === null ||
      session.game.turnDeadlineAt === null
    ) {
      return {
        turnStartedAt: now,
        turnDeadlineAt: addSeconds(now, session.game.turnTimeoutSeconds),
      };
    }

    return {
      turnStartedAt: session.game.turnStartedAt,
      turnDeadlineAt: session.game.turnDeadlineAt,
    };
  }

  async #saveResult(
    session: GameSession,
    previousState: EngineState | null,
    result: EngineResult,
    now: Date,
    forceFreshDeadline = false,
  ): Promise<void> {
    const timing = this.#timingForTransition(
      session,
      previousState,
      result.state,
      now,
      forceFreshDeadline,
    );
    await session.saveState({
      previousState,
      state: result.state,
      events: result.events,
      turnStartedAt: timing.turnStartedAt,
      turnDeadlineAt: timing.turnDeadlineAt,
      now,
    });
  }

  async startGame(gameId: string, now = this.#now()): Promise<EngineState> {
    return this.#withGame(gameId, async (session) => {
      if (session.game.status !== "lobby" || session.game.state !== null) {
        throw new OrchestrationError(
          "invalid_game_status",
          "Only a lobby can be started",
          { status: session.game.status },
        );
      }
      if (session.game.players.length !== session.game.playerLimit) {
        throw new OrchestrationError(
          "invalid_game_configuration",
          `The lobby requires ${session.game.playerLimit} players before it can start`,
          {
            playerLimit: session.game.playerLimit,
            registeredPlayers: session.game.players.length,
          },
        );
      }

      let state: EngineState;
      try {
        state = createGame({
          gameId,
          seed: session.game.seed,
          players: session.game.players,
          victoryPointsToWin: session.game.victoryPointsToWin,
        });
      } catch (error) {
        mapRulesError(error);
      }

      await this.#saveResult(
        session,
        null,
        {
          state,
          events: [lifecycleEvent("gameStarted", { gameId })],
        },
        now,
        true,
      );
      return state;
    });
  }

  async #advanceExpiredWithinSession(
    session: GameSession,
    now: Date,
  ): Promise<number> {
    let appliedActions = 0;

    while (isDeadlineDue(session, now)) {
      const state = requireState(session);
      const actorPlayerId = state.turn.requiredActorPlayerIds[0];
      if (!actorPlayerId) {
        throw new OrchestrationError(
          "invalid_snapshot",
          `No required actor is available during ${state.turn.phase}`,
        );
      }
      const fallback = chooseFallbackAction(state, actorPlayerId);
      if (!fallback) {
        throw new OrchestrationError(
          "invalid_snapshot",
          `No fallback action is available during ${state.turn.phase}`,
        );
      }

      let result: EngineResult;
      try {
        result = applyAction(state, actorPlayerId, fallback);
      } catch (error) {
        mapRulesError(error);
      }
      result.events.unshift(
        lifecycleEvent("deadlineActionApplied", {
          playerId: actorPlayerId,
          actionType: fallback.type,
          previousVersion: state.version,
        }),
      );
      await this.#saveResult(session, state, result, now);
      appliedActions += 1;

      if (appliedActions > MAX_FALLBACK_ACTIONS_PER_DEADLINE) {
        throw new OrchestrationError(
          "invalid_snapshot",
          "Deadline advancement exceeded the safety limit",
        );
      }
    }

    return appliedActions;
  }

  async submitAction(input: SubmitActionInput): Promise<EngineResult> {
    const now = input.now ?? this.#now();
    const outcome = await this.#withGame(input.gameId, async (session) => {
      if (isDeadlineDue(session, now)) {
        await this.#advanceExpiredWithinSession(session, now);
        return {
          kind: "deadline_advanced" as const,
          currentVersion: session.game.stateVersion,
        };
      }

      assertExpectedVersion(session, input.expectedVersion);
      const state = requireState(session);
      let result: EngineResult;
      try {
        result = applyAction(state, input.playerId, input.action);
      } catch (error) {
        mapRulesError(error);
      }
      await this.#saveResult(session, state, result, now);
      return { kind: "applied" as const, result };
    });

    if (outcome.kind === "deadline_advanced") {
      throw new OrchestrationError(
        "stale_state",
        "The turn deadline elapsed before the action was applied",
        {
          expectedVersion: input.expectedVersion,
          currentVersion: outcome.currentVersion,
          deadlineAdvanced: true,
        },
      );
    }
    return outcome.result;
  }

  async executePlayerTrade(
    input: ExecutePlayerTradeInput,
  ): Promise<EngineResult> {
    const now = input.now ?? this.#now();
    const outcome = await this.#withGame(input.gameId, async (session) => {
      if (isDeadlineDue(session, now)) {
        await this.#advanceExpiredWithinSession(session, now);
        return {
          kind: "deadline_advanced" as const,
          currentVersion: session.game.stateVersion,
        };
      }

      assertExpectedVersion(session, input.expectedVersion);
      const state = requireState(session);
      let result: EngineResult;
      try {
        result = applyPlayerTrade(
          state,
          input.fromPlayerId,
          input.toPlayerId,
          input.offering,
          input.requesting,
        );
      } catch (error) {
        mapRulesError(error);
      }
      await this.#saveResult(session, state, result, now);
      return { kind: "applied" as const, result };
    });

    if (outcome.kind === "deadline_advanced") {
      throw new OrchestrationError(
        "stale_state",
        "The turn deadline elapsed before the trade was applied",
        {
          expectedVersion: input.expectedVersion,
          currentVersion: outcome.currentVersion,
          deadlineAdvanced: true,
        },
      );
    }
    return outcome.result;
  }

  async pauseGame(input: LifecycleCommandInput): Promise<EngineState> {
    const now = input.now ?? this.#now();
    return this.#withGame(input.gameId, async (session) => {
      assertExpectedVersion(session, input.expectedVersion);
      const state = requireState(session);
      if (!isRunningStatus(state.status)) {
        throw new OrchestrationError(
          "invalid_game_status",
          "Only a running game can be paused",
          { status: state.status },
        );
      }

      const nextState = structuredClone(state);
      nextState.status = "paused";
      nextState.version += 1;
      await this.#saveResult(
        session,
        state,
        {
          state: nextState,
          events: [lifecycleEvent("gamePaused", { gameId: input.gameId })],
        },
        now,
      );
      return nextState;
    });
  }

  async resumeGame(input: LifecycleCommandInput): Promise<EngineState> {
    const now = input.now ?? this.#now();
    return this.#withGame(input.gameId, async (session) => {
      assertExpectedVersion(session, input.expectedVersion);
      const state = requireState(session);
      if (state.status !== "paused") {
        throw new OrchestrationError(
          "invalid_game_status",
          "Only a paused game can be resumed",
          { status: state.status },
        );
      }

      const nextState = structuredClone(state);
      nextState.status =
        nextState.turnNumber === 0 ? "initial_placement" : "active";
      nextState.version += 1;
      await this.#saveResult(
        session,
        state,
        {
          state: nextState,
          events: [lifecycleEvent("gameResumed", { gameId: input.gameId })],
        },
        now,
        true,
      );
      return nextState;
    });
  }

  async stopGame(input: LifecycleCommandInput): Promise<EngineState | null> {
    const now = input.now ?? this.#now();
    return this.#withGame(input.gameId, async (session) => {
      assertExpectedVersion(session, input.expectedVersion);
      if (session.game.status === "lobby") {
        await session.saveStatus("stopped", now);
        return null;
      }

      const state = requireState(session);
      if (state.status === "finished" || state.status === "stopped") {
        throw new OrchestrationError(
          "invalid_game_status",
          "The game is already terminal",
          { status: state.status },
        );
      }
      const nextState = structuredClone(state);
      nextState.status = "stopped";
      nextState.version += 1;
      nextState.turn.requiredActorPlayerIds = [];
      await this.#saveResult(
        session,
        state,
        {
          state: nextState,
          events: [lifecycleEvent("gameStopped", { gameId: input.gameId })],
        },
        now,
      );
      return nextState;
    });
  }

  async advanceClaimedGame(
    gameId: string,
    workerId: string,
    now = this.#now(),
  ): Promise<number> {
    return this.#withGame(gameId, async (session) => {
      if (session.game.deadlineClaimedBy !== workerId) {
        throw new OrchestrationError(
          "deadline_claim_lost",
          "The deadline lease is owned by another worker",
          { gameId, workerId, claimedBy: session.game.deadlineClaimedBy },
        );
      }
      if (!isDeadlineDue(session, now)) {
        await session.releaseDeadlineClaim(workerId);
        return 0;
      }

      const appliedActions = await this.#advanceExpiredWithinSession(
        session,
        now,
      );
      await session.releaseDeadlineClaim(workerId);
      return appliedActions;
    });
  }

  async claimAndAdvanceExpired(
    input: DeadlineBatchInput,
  ): Promise<DeadlineBatchResult> {
    const now = input.now ?? this.#now();
    const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
    const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new RangeError("batchSize must be a positive integer");
    }
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new RangeError("leaseDurationMs must be a positive integer");
    }

    const claimedGameIds = await this.#store.claimExpiredGames({
      workerId: input.workerId,
      now,
      leaseUntil: new Date(now.getTime() + leaseDurationMs),
      limit: batchSize,
    });
    const advancedGameIds: string[] = [];
    const failures: DeadlineBatchResult["failures"] = [];
    let advancedActionCount = 0;

    for (const gameId of claimedGameIds) {
      try {
        const count = await this.advanceClaimedGame(
          gameId,
          input.workerId,
          now,
        );
        if (count > 0) {
          advancedGameIds.push(gameId);
          advancedActionCount += count;
        }
      } catch (error) {
        failures.push({
          gameId,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return {
      claimedGameIds,
      advancedGameIds,
      advancedActionCount,
      failures,
    };
  }
}
