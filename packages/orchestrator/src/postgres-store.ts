import { randomBytes } from "node:crypto";

import {
  getPublicVictoryPoints,
  sumResources,
  type EnginePlayerInput,
  type EngineState,
} from "@catanbench/engine";
import type { Pool, PoolClient } from "pg";

import type {
  ClaimExpiredGamesInput,
  GameSession,
  OrchestrationStore,
  PersistedGameStatus,
  SaveStateInput,
  StoredGame,
  StoredTradeProposal,
} from "./types";
import { OrchestrationError, StoredGameNotFoundError } from "./types";

interface GameRow {
  id: string;
  status: PersistedGameStatus;
  stateVersion: number;
  turnTimeoutSeconds: number;
  victoryPointsToWin: number;
  playerLimit: number;
  seed: string;
  turnStartedAt: Date | null;
  turnDeadlineAt: Date | null;
  deadlineClaimedBy: string | null;
  deadlineClaimedUntil: Date | null;
}

interface PlayerRow {
  id: string;
  seat: number;
  name: string;
  color: EnginePlayerInput["color"];
}

interface SnapshotRow {
  version: number;
  state: unknown;
}

function eventId(): string {
  return `evt_${randomBytes(14).toString("hex")}`;
}

function parseEngineState(
  value: unknown,
  gameId: string,
  expectedVersion: number,
): EngineState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("gameId" in value) ||
    value.gameId !== gameId ||
    !("version" in value) ||
    value.version !== expectedVersion ||
    !("turn" in value) ||
    typeof value.turn !== "object" ||
    value.turn === null ||
    !("players" in value) ||
    !Array.isArray(value.players)
  ) {
    throw new OrchestrationError(
      "invalid_snapshot",
      `The latest snapshot for ${gameId} is invalid`,
      { expectedVersion },
    );
  }
  return value as EngineState;
}

class PostgresGameSession implements GameSession {
  game: StoredGame;
  readonly #client: PoolClient;

  constructor(client: PoolClient, game: StoredGame) {
    this.#client = client;
    this.game = game;
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
      throw new OrchestrationError(
        "invalid_snapshot",
        "The transition version does not follow the stored game version",
        {
          storedVersion: expectedVersion,
          previousVersion: input.previousState?.version ?? null,
          nextVersion: input.state.version,
        },
      );
    }

    const update = await this.#client.query(
      `update catanbench.games
       set status = $2::catanbench.game_status,
           state_version = $3,
           turn_number = $4,
           phase = $5,
           active_player_id = $6,
           required_actor_player_ids = $7::jsonb,
           turn_started_at = $8,
           turn_deadline_at = $9,
           winner_player_id = $10,
           updated_at = $11,
           finished_at = case
             when $2::catanbench.game_status = 'finished' then coalesce(finished_at, $11)
             else finished_at
           end,
           stopped_at = case
             when $2::catanbench.game_status = 'stopped' then coalesce(stopped_at, $11)
             else stopped_at
           end
       where id = $1 and state_version = $12`,
      [
        this.game.id,
        input.state.status,
        input.state.version,
        input.state.turnNumber,
        input.state.turn.phase,
        input.state.turn.activePlayerId,
        JSON.stringify(input.state.turn.requiredActorPlayerIds),
        input.turnStartedAt,
        input.turnDeadlineAt,
        input.state.winnerPlayerId,
        input.now,
        expectedVersion,
      ],
    );
    if (update.rowCount !== 1) {
      throw new OrchestrationError(
        "stale_state",
        "The stored game version changed during the transaction",
        { expectedVersion },
      );
    }

    await this.#client.query(
      `insert into catanbench.game_snapshots (game_id, version, state, created_at)
       values ($1, $2, $3::jsonb, $4)`,
      [
        this.game.id,
        input.state.version,
        JSON.stringify(input.state),
        input.now,
      ],
    );

    for (const [sequence, event] of input.events.entries()) {
      await this.#client.query(
        `insert into catanbench.game_events
          (id, game_id, version, sequence, type, actor_player_id, visibility,
           visible_to_player_id, payload, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
        [
          eventId(),
          this.game.id,
          input.state.version,
          sequence,
          event.type,
          event.actorPlayerId,
          event.visibility,
          event.visibleToPlayerId ?? null,
          JSON.stringify(event.data),
          input.now,
        ],
      );
    }

    for (const player of input.state.players) {
      const playerUpdate = await this.#client.query(
        `update catanbench.players
         set resource_count = $3,
             development_card_count = $4,
             public_victory_points = $5,
             played_knights = $6,
             roads_remaining = $7,
             settlements_remaining = $8,
             cities_remaining = $9,
             updated_at = $10
         where game_id = $1 and id = $2`,
        [
          this.game.id,
          player.id,
          sumResources(player.resources),
          player.developmentCards.filter((card) => !card.played).length,
          getPublicVictoryPoints(input.state, player.id),
          player.playedKnights,
          player.roadsRemaining,
          player.settlementsRemaining,
          player.citiesRemaining,
          input.now,
        ],
      );
      if (playerUpdate.rowCount !== 1) {
        throw new OrchestrationError(
          "invalid_snapshot",
          `Snapshot player ${player.id} is not registered with the game`,
        );
      }
    }

    const activePlayerChanged =
      input.previousState !== null &&
      input.previousState.turn.activePlayerId !==
        input.state.turn.activePlayerId;
    if (
      activePlayerChanged ||
      input.state.status === "finished" ||
      input.state.status === "stopped"
    ) {
      await this.#client.query(
        `update catanbench.trade_proposals
         set status = 'expired', updated_at = $2
         where game_id = $1 and status = 'open'`,
        [this.game.id, input.now],
      );
    }

    this.game = {
      ...this.game,
      status: input.state.status,
      stateVersion: input.state.version,
      turnStartedAt: input.turnStartedAt,
      turnDeadlineAt: input.turnDeadlineAt,
      state: input.state,
    };
  }

  async saveStatus(status: PersistedGameStatus, now: Date): Promise<void> {
    const result = await this.#client.query(
      `update catanbench.games
       set status = $2::catanbench.game_status,
           turn_started_at = null,
           turn_deadline_at = null,
           deadline_claimed_by = null,
           deadline_claimed_until = null,
           stopped_at = case
             when $2::catanbench.game_status = 'stopped' then $3
             else stopped_at
           end,
           updated_at = $3
       where id = $1 and state_version = $4`,
      [this.game.id, status, now, this.game.stateVersion],
    );
    if (result.rowCount !== 1) {
      throw new OrchestrationError(
        "stale_state",
        "The game changed while its lifecycle status was being updated",
      );
    }
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
    const result = await this.#client.query(
      `insert into catanbench.trade_proposals
        (id, game_id, created_at_version, from_player_id, to_player_id,
         offering, requesting, status, expires_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'open', $8, $9, $9)`,
      [
        proposal.id,
        proposal.gameId,
        proposal.createdAtVersion,
        proposal.fromPlayerId,
        proposal.toPlayerId,
        JSON.stringify(proposal.offering),
        JSON.stringify(proposal.requesting),
        proposal.expiresAt,
        proposal.createdAt,
      ],
    );
    if (result.rowCount !== 1) {
      throw new OrchestrationError(
        "invalid_snapshot",
        "The trade proposal could not be persisted",
      );
    }
  }

  async releaseDeadlineClaim(workerId: string): Promise<boolean> {
    const result = await this.#client.query(
      `update catanbench.games
       set deadline_claimed_by = null, deadline_claimed_until = null
       where id = $1 and deadline_claimed_by = $2`,
      [this.game.id, workerId],
    );
    if (result.rowCount === 1) {
      this.game = {
        ...this.game,
        deadlineClaimedBy: null,
        deadlineClaimedUntil: null,
      };
      return true;
    }
    return false;
  }
}

export class PostgresOrchestrationStore implements OrchestrationStore {
  readonly #pool: Pool;
  readonly #transactionClient: PoolClient | null;

  constructor(pool: Pool, transactionClient: PoolClient | null = null) {
    this.#pool = pool;
    this.#transactionClient = transactionClient;
  }

  async withGameLock<T>(
    gameId: string,
    operation: (session: GameSession) => Promise<T>,
  ): Promise<T> {
    const managesTransaction = this.#transactionClient === null;
    const client = this.#transactionClient ?? (await this.#pool.connect());
    try {
      if (managesTransaction) {
        await client.query("begin");
      }
      const gameResult = await client.query<GameRow>(
        `select id,
                status,
                state_version as "stateVersion",
                turn_timeout_seconds as "turnTimeoutSeconds",
                victory_points_to_win as "victoryPointsToWin",
                player_limit as "playerLimit",
                seed,
                turn_started_at as "turnStartedAt",
                turn_deadline_at as "turnDeadlineAt",
                deadline_claimed_by as "deadlineClaimedBy",
                deadline_claimed_until as "deadlineClaimedUntil"
         from catanbench.games
         where id = $1
         for update`,
        [gameId],
      );
      const gameRow = gameResult.rows[0];
      if (!gameRow) {
        throw new StoredGameNotFoundError(gameId);
      }

      const [playersResult, snapshotResult] = await Promise.all([
        client.query<PlayerRow>(
          `select id, seat, name, color
           from catanbench.players
           where game_id = $1
           order by seat`,
          [gameId],
        ),
        client.query<SnapshotRow>(
          `select version, state
           from catanbench.game_snapshots
           where game_id = $1
           order by version desc
           limit 1`,
          [gameId],
        ),
      ]);
      const snapshot = snapshotResult.rows[0];
      const state = snapshot
        ? parseEngineState(snapshot.state, gameId, gameRow.stateVersion)
        : null;
      if (snapshot && snapshot.version !== gameRow.stateVersion) {
        throw new OrchestrationError(
          "invalid_snapshot",
          "The game row and latest snapshot versions do not match",
          {
            gameVersion: gameRow.stateVersion,
            snapshotVersion: snapshot.version,
          },
        );
      }

      const game: StoredGame = {
        ...gameRow,
        players: playersResult.rows.map((player) => ({ ...player })),
        state,
      };
      const result = await operation(new PostgresGameSession(client, game));
      if (managesTransaction) {
        await client.query("commit");
      }
      return result;
    } catch (error) {
      if (managesTransaction) {
        await client.query("rollback");
      }
      throw error;
    } finally {
      if (managesTransaction) {
        client.release();
      }
    }
  }

  async claimExpiredGames(input: ClaimExpiredGamesInput): Promise<string[]> {
    const result = await this.#pool.query<{ id: string }>(
      `with due_games as (
         select id
         from catanbench.games
         where status in ('initial_placement', 'active')
           and turn_deadline_at <= $1
           and (
             deadline_claimed_until is null
             or deadline_claimed_until <= $1
           )
         order by turn_deadline_at, id
         for update skip locked
         limit $2
       )
       update catanbench.games as game
       set deadline_claimed_by = $3,
           deadline_claimed_until = $4
       from due_games
       where game.id = due_games.id
       returning game.id`,
      [input.now, input.limit, input.workerId, input.leaseUntil],
    );
    return result.rows.map((row) => row.id);
  }
}
