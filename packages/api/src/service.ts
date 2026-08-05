import { createHash, randomBytes } from "node:crypto";

import type { EngineState } from "@catanbench/engine";
import { GameOrchestrator } from "@catanbench/orchestrator";
import { PostgresOrchestrationStore } from "@catanbench/orchestrator/postgres";
import {
  ChatMessagesResponseSchema,
  CreateTradeProposalResponseSchema,
  GameCommandResponseSchema,
  LegalActionsResponseSchema,
  PostChatMessageResponseSchema,
  RegisterAgentResponseSchema,
  TradeProposalsResponseSchema,
  type CreateTradeProposalRequest,
  type GameState,
  type PlayerColor,
  type PostChatMessageRequest,
  type RegisterAgentRequest,
  type SubmitActionRequest,
  type TradeProposal,
  type ExecuteTradeRequest,
} from "@catanbench/protocol";
import type { Pool, PoolClient } from "pg";

import { AgentApiError, toAgentApiError } from "./errors";
import {
  projectGameState,
  type GameProjectionRecord,
  type PlayerProjectionRecord,
} from "./projection";

const PLAYER_COLORS: PlayerColor[] = ["red", "blue", "white", "orange"];
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;

export interface AuthenticatedAgent {
  gameId: string;
  playerId: string;
}

export interface AgentApiCommandResult {
  status: number;
  body: unknown;
  replayed: boolean;
}

interface CommandOperationResult {
  status: number;
  body: unknown;
  playerId?: string;
}

interface CredentialRow {
  gameId: string;
  playerId: string;
}

interface GameSnapshotRow extends GameProjectionRecord {
  snapshotVersion: number | null;
  state: unknown;
}

interface EventRow {
  id: string;
  version: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
}

interface IdempotencyRow {
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
}

interface ChatRow {
  id: string;
  playerId: string;
  message: string;
  createdAt: Date;
}

interface TradeRow {
  id: string;
  fromPlayerId: string;
  toPlayerId: string | null;
  offering: TradeProposal["offering"];
  requesting: TradeProposal["requesting"];
  status: TradeProposal["status"];
  expiresAt: Date;
  createdAt: Date;
}

function opaqueId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

function agentToken(): string {
  return `cb_agent_${randomBytes(32).toString("base64url")}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function visibleEvent(row: EventRow) {
  return {
    id: row.id,
    version: row.version,
    type: row.type,
    createdAt: row.createdAt.toISOString(),
    data: row.payload,
  };
}

function tradeProposal(row: TradeRow): TradeProposal {
  return {
    id: row.id,
    fromPlayerId: row.fromPlayerId,
    toPlayerId: row.toPlayerId,
    offering: row.offering,
    requesting: row.requesting,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export class AgentApi {
  readonly #pool: Pool;
  readonly #now: () => Date;

  constructor(pool: Pool, now: () => Date = () => new Date()) {
    this.#pool = pool;
    this.#now = now;
  }

  async #withIdempotency(
    input: {
      gameId: string;
      playerId: string | null;
      scope: string;
      key: string;
      request: unknown;
      now: Date;
    },
    operation: (client: PoolClient) => Promise<CommandOperationResult>,
  ): Promise<AgentApiCommandResult> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "select pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${input.gameId}:${input.scope}:${input.key}`],
      );

      const game = await client.query<{ id: string }>(
        "select id from catanbench.games where id = $1",
        [input.gameId],
      );
      if (!game.rows[0]) {
        throw new AgentApiError(
          "game_not_found",
          404,
          `Game not found: ${input.gameId}`,
        );
      }

      const hash = requestHash({
        gameId: input.gameId,
        playerId: input.playerId,
        scope: input.scope,
        request: input.request,
      });
      const existingResult = await client.query<IdempotencyRow>(
        `select request_hash as "requestHash",
                response_status as "responseStatus",
                response_body as "responseBody"
         from catanbench.idempotency_keys
         where game_id = $1 and scope = $2 and key = $3
         for update`,
        [input.gameId, input.scope, input.key],
      );
      const existing = existingResult.rows[0];
      if (existing) {
        if (existing.requestHash !== hash) {
          throw new AgentApiError(
            "idempotency_conflict",
            409,
            "This idempotency key was already used for a different request",
          );
        }
        if (
          existing.responseStatus === null ||
          existing.responseBody === null
        ) {
          throw new AgentApiError(
            "internal_error",
            500,
            "The original idempotent request did not finish",
            { retryable: true },
          );
        }
        await client.query("commit");
        return {
          status: existing.responseStatus,
          body: existing.responseBody,
          replayed: true,
        };
      }

      await client.query(
        `insert into catanbench.idempotency_keys
          (game_id, player_id, scope, key, request_hash, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.gameId,
          input.playerId,
          input.scope,
          input.key,
          hash,
          input.now,
          new Date(input.now.getTime() + IDEMPOTENCY_TTL_MS),
        ],
      );

      let response: CommandOperationResult;
      try {
        response = await operation(client);
      } catch (error) {
        const apiError = toAgentApiError(error);
        if (apiError.status >= 500) {
          throw apiError;
        }
        response = {
          status: apiError.status,
          body: apiError.toResponse(),
        };
      }

      const saved = await client.query(
        `update catanbench.idempotency_keys
         set player_id = coalesce($4, player_id),
             response_status = $5,
             response_body = $6::jsonb
         where game_id = $1 and scope = $2 and key = $3`,
        [
          input.gameId,
          input.scope,
          input.key,
          response.playerId ?? input.playerId,
          response.status,
          JSON.stringify(response.body),
        ],
      );
      if (saved.rowCount !== 1) {
        throw new AgentApiError(
          "internal_error",
          500,
          "The idempotent response could not be saved",
          { retryable: true },
        );
      }
      await client.query("commit");
      return { ...response, replayed: false };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async registerAgent(
    gameId: string,
    request: RegisterAgentRequest,
    idempotencyKey: string,
  ): Promise<AgentApiCommandResult> {
    const now = this.#now();
    return this.#withIdempotency(
      {
        gameId,
        playerId: null,
        scope: "register_agent",
        key: idempotencyKey,
        request,
        now,
      },
      async (client) => {
        const gameResult = await client.query<{
          status: string;
          playerLimit: number;
        }>(
          `select status, player_limit as "playerLimit"
           from catanbench.games where id = $1 for update`,
          [gameId],
        );
        const game = gameResult.rows[0];
        if (!game) {
          throw new AgentApiError(
            "game_not_found",
            404,
            `Game not found: ${gameId}`,
          );
        }
        if (game.status !== "lobby") {
          throw new AgentApiError(
            "registration_closed",
            409,
            "Agents may register only while the game is in the lobby",
          );
        }

        const playersResult = await client.query<{
          seat: number;
          name: string;
        }>(
          `select seat, name from catanbench.players
           where game_id = $1 order by seat`,
          [gameId],
        );
        if (playersResult.rows.some((player) => player.name === request.name)) {
          throw new AgentApiError(
            "agent_name_taken",
            409,
            "An agent with this name is already registered for the game",
          );
        }
        if (playersResult.rows.length >= game.playerLimit) {
          throw new AgentApiError(
            "game_full",
            409,
            "All player seats are already filled",
          );
        }

        const occupiedSeats = new Set(
          playersResult.rows.map((player) => player.seat),
        );
        const seat = Array.from(
          { length: game.playerLimit },
          (_, index) => index,
        ).find((candidate) => !occupiedSeats.has(candidate));
        const color = seat === undefined ? undefined : PLAYER_COLORS[seat];
        if (seat === undefined || !color) {
          throw new AgentApiError(
            "game_full",
            409,
            "No valid player seat is available",
          );
        }

        const playerId = opaqueId("player");
        const token = agentToken();
        await client.query(
          `insert into catanbench.players
            (id, game_id, seat, name, color, registered_at, updated_at)
           values ($1, $2, $3, $4, $5::catanbench.player_color, $6, $6)`,
          [playerId, gameId, seat, request.name, color, now],
        );
        await client.query(
          `insert into catanbench.agent_credentials
            (id, game_id, player_id, token_hash, created_at)
           values ($1, $2, $3, $4, $5)`,
          [opaqueId("cred"), gameId, playerId, hashToken(token), now],
        );

        return {
          status: 201,
          playerId,
          body: RegisterAgentResponseSchema.parse({
            gameId,
            playerId,
            seat,
            color,
            token,
          }),
        };
      },
    );
  }

  async authenticate(
    gameId: string,
    token: string,
  ): Promise<AuthenticatedAgent> {
    const credentialResult = await this.#pool.query<CredentialRow>(
      `select game_id as "gameId", player_id as "playerId"
       from catanbench.agent_credentials
       where token_hash = $1 and revoked_at is null`,
      [hashToken(token)],
    );
    const credential = credentialResult.rows[0];
    if (!credential) {
      throw new AgentApiError(
        "invalid_token",
        401,
        "The bearer token is invalid or has been revoked",
      );
    }
    if (credential.gameId !== gameId) {
      throw new AgentApiError(
        "not_a_participant",
        403,
        "This token does not identify a participant in the requested game",
      );
    }
    await this.#pool.query(
      `update catanbench.agent_credentials
       set last_used_at = $2
       where token_hash = $1`,
      [hashToken(token), this.#now()],
    );
    return credential;
  }

  async getGameState(agent: AuthenticatedAgent): Promise<GameState> {
    const now = this.#now();
    const gameResult = await this.#pool.query<GameSnapshotRow>(
      `select game.id,
              game.status,
              game.state_version as "stateVersion",
              game.turn_number as "turnNumber",
              game.turn_timeout_seconds as "turnTimeoutSeconds",
              game.victory_points_to_win as "victoryPointsToWin",
              game.winner_player_id as "winnerPlayerId",
              game.turn_started_at as "turnStartedAt",
              game.turn_deadline_at as "turnDeadlineAt",
              snapshot.version as "snapshotVersion",
              snapshot.state
       from catanbench.games as game
       left join lateral (
         select version, state
         from catanbench.game_snapshots
         where game_id = game.id
         order by version desc
         limit 1
       ) as snapshot on true
       where game.id = $1`,
      [agent.gameId],
    );
    const game = gameResult.rows[0];
    if (!game) {
      throw new AgentApiError(
        "game_not_found",
        404,
        `Game not found: ${agent.gameId}`,
      );
    }
    if (
      game.snapshotVersion !== null &&
      game.snapshotVersion !== game.stateVersion
    ) {
      throw new AgentApiError(
        "internal_error",
        500,
        "The game row and latest snapshot versions do not match",
        { retryable: true },
      );
    }

    const [playersResult, eventsResult] = await Promise.all([
      this.#pool.query<PlayerProjectionRecord>(
        `select id, seat, name, color,
                resource_count as "resourceCount",
                development_card_count as "developmentCardCount",
                public_victory_points as "publicVictoryPoints",
                played_knights as "playedKnights",
                roads_remaining as "roadsRemaining",
                settlements_remaining as "settlementsRemaining",
                cities_remaining as "citiesRemaining"
         from catanbench.players
         where game_id = $1
         order by seat`,
        [agent.gameId],
      ),
      this.#pool.query<EventRow>(
        `select id, version, type, payload, created_at as "createdAt"
         from catanbench.game_events
         where game_id = $1
           and version <= $2
           and (visibility = 'public' or visible_to_player_id = $3)
         order by version desc, sequence desc
         limit 50`,
        [agent.gameId, game.stateVersion, agent.playerId],
      ),
    ]);
    const state = game.state as EngineState | null;
    if (
      state !== null &&
      (state.gameId !== game.id || state.version !== game.stateVersion)
    ) {
      throw new AgentApiError(
        "internal_error",
        500,
        "The latest game snapshot is invalid",
        { retryable: true },
      );
    }

    return projectGameState({
      game,
      playerId: agent.playerId,
      players: playersResult.rows,
      state,
      recentEvents: eventsResult.rows.reverse().map(visibleEvent),
      serverTime: now,
    });
  }

  async getLegalActions(agent: AuthenticatedAgent) {
    const state = await this.getGameState(agent);
    return LegalActionsResponseSchema.parse({
      gameId: state.game.id,
      version: state.game.version,
      phase: state.turn?.phase ?? null,
      deadlineAt: state.turn?.deadlineAt ?? null,
      legalActions: state.legalActions,
    });
  }

  async #getCommandEvent(
    client: PoolClient,
    gameId: string,
    playerId: string,
    version: number,
  ) {
    const eventResult = await client.query<EventRow>(
      `select id, version, type, payload, created_at as "createdAt"
       from catanbench.game_events
       where game_id = $1 and version = $2
         and (visibility = 'public' or visible_to_player_id = $3)
       order by sequence
       limit 1`,
      [gameId, version, playerId],
    );
    const event = eventResult.rows[0];
    if (!event) {
      throw new AgentApiError(
        "internal_error",
        500,
        "The command completed without a visible event",
        { retryable: true },
      );
    }
    return visibleEvent(event);
  }

  async submitAction(
    agent: AuthenticatedAgent,
    request: SubmitActionRequest,
    idempotencyKey: string,
  ): Promise<AgentApiCommandResult> {
    const now = this.#now();
    return this.#withIdempotency(
      {
        gameId: agent.gameId,
        playerId: agent.playerId,
        scope: "submit_action",
        key: idempotencyKey,
        request,
        now,
      },
      async (client) => {
        const orchestrator = new GameOrchestrator(
          new PostgresOrchestrationStore(this.#pool, client),
          () => now,
        );
        const result = await orchestrator.submitAction({
          gameId: agent.gameId,
          playerId: agent.playerId,
          expectedVersion: request.expectedVersion,
          action: request.action,
          now,
        });
        return {
          status: 200,
          body: GameCommandResponseSchema.parse({
            gameId: agent.gameId,
            version: result.state.version,
            event: await this.#getCommandEvent(
              client,
              agent.gameId,
              agent.playerId,
              result.state.version,
            ),
          }),
        };
      },
    );
  }

  async postChatMessage(
    agent: AuthenticatedAgent,
    request: PostChatMessageRequest,
    idempotencyKey: string,
  ): Promise<AgentApiCommandResult> {
    const now = this.#now();
    return this.#withIdempotency(
      {
        gameId: agent.gameId,
        playerId: agent.playerId,
        scope: "post_chat",
        key: idempotencyKey,
        request,
        now,
      },
      async (client) => {
        const message = {
          id: opaqueId("msg"),
          playerId: agent.playerId,
          message: request.message,
          createdAt: now.toISOString(),
        };
        await client.query(
          `insert into catanbench.chat_messages
            (id, game_id, player_id, message, created_at)
           values ($1, $2, $3, $4, $5)`,
          [message.id, agent.gameId, agent.playerId, message.message, now],
        );
        return {
          status: 201,
          body: PostChatMessageResponseSchema.parse({ message }),
        };
      },
    );
  }

  async getChatMessages(agent: AuthenticatedAgent, after: string | null) {
    let cursor: { createdAt: Date; id: string } | null = null;
    if (after) {
      const cursorResult = await this.#pool.query<{
        createdAt: Date;
        id: string;
      }>(
        `select created_at as "createdAt", id
         from catanbench.chat_messages
         where game_id = $1 and id = $2`,
        [agent.gameId, after],
      );
      cursor = cursorResult.rows[0] ?? null;
      if (!cursor) {
        throw new AgentApiError(
          "invalid_request",
          400,
          "The chat cursor does not exist in this game",
        );
      }
    }

    const messagesResult = await this.#pool.query<ChatRow>(
      `select id, player_id as "playerId", message, created_at as "createdAt"
       from catanbench.chat_messages
       where game_id = $1
         and ($2::timestamptz is null or (created_at, id) > ($2, $3))
       order by created_at, id
       limit 100`,
      [agent.gameId, cursor?.createdAt ?? null, cursor?.id ?? ""],
    );
    return ChatMessagesResponseSchema.parse({
      messages: messagesResult.rows.map((message) => ({
        ...message,
        createdAt: message.createdAt.toISOString(),
      })),
    });
  }

  async createTradeProposal(
    agent: AuthenticatedAgent,
    request: CreateTradeProposalRequest,
    idempotencyKey: string,
  ): Promise<AgentApiCommandResult> {
    const now = this.#now();
    return this.#withIdempotency(
      {
        gameId: agent.gameId,
        playerId: agent.playerId,
        scope: "create_trade_proposal",
        key: idempotencyKey,
        request,
        now,
      },
      async (client) => {
        const orchestrator = new GameOrchestrator(
          new PostgresOrchestrationStore(this.#pool, client),
          () => now,
        );
        const result = await orchestrator.createPlayerTradeProposal({
          gameId: agent.gameId,
          proposalId: opaqueId("trade"),
          fromPlayerId: agent.playerId,
          toPlayerId: request.toPlayerId,
          expectedVersion: request.expectedVersion,
          offering: request.offering,
          requesting: request.requesting,
          now,
        });
        return {
          status: 201,
          body: CreateTradeProposalResponseSchema.parse({
            proposal: {
              id: result.proposal.id,
              fromPlayerId: result.proposal.fromPlayerId,
              toPlayerId: result.proposal.toPlayerId,
              offering: result.proposal.offering,
              requesting: result.proposal.requesting,
              status: "open",
              createdAt: result.proposal.createdAt.toISOString(),
              expiresAt: result.proposal.expiresAt.toISOString(),
            },
            version: result.state.version,
          }),
        };
      },
    );
  }

  async getTradeProposals(
    agent: AuthenticatedAgent,
    status: TradeProposal["status"] | null,
  ) {
    const now = this.#now();
    const proposalsResult = await this.#pool.query<TradeRow>(
      `select id,
              from_player_id as "fromPlayerId",
              to_player_id as "toPlayerId",
              offering,
              requesting,
              case
                when status = 'open' and expires_at <= $2 then 'expired'
                else status::text
              end as status,
              expires_at as "expiresAt",
              created_at as "createdAt"
       from catanbench.trade_proposals
       where game_id = $1
         and (from_player_id = $3 or to_player_id is null or to_player_id = $3)
         and (
           $4::text is null
           or case
             when status = 'open' and expires_at <= $2 then 'expired'
             else status::text
           end = $4
         )
       order by created_at desc, id desc
       limit 100`,
      [agent.gameId, now, agent.playerId, status],
    );
    return TradeProposalsResponseSchema.parse({
      proposals: proposalsResult.rows.map(tradeProposal),
    });
  }

  async executeTrade(
    agent: AuthenticatedAgent,
    request: ExecuteTradeRequest,
    idempotencyKey: string,
  ): Promise<AgentApiCommandResult> {
    const now = this.#now();
    return this.#withIdempotency(
      {
        gameId: agent.gameId,
        playerId: agent.playerId,
        scope: "execute_trade",
        key: idempotencyKey,
        request,
        now,
      },
      async (client) => {
        const proposalResult = await client.query<TradeRow>(
          `select id,
                  from_player_id as "fromPlayerId",
                  to_player_id as "toPlayerId",
                  offering,
                  requesting,
                  status,
                  expires_at as "expiresAt",
                  created_at as "createdAt"
           from catanbench.trade_proposals
           where game_id = $1 and id = $2`,
          [agent.gameId, request.proposalId],
        );
        const proposal = proposalResult.rows[0];
        if (!proposal) {
          throw new AgentApiError(
            "proposal_not_found",
            404,
            "The trade proposal does not exist",
          );
        }
        if (
          proposal.fromPlayerId === agent.playerId ||
          (proposal.toPlayerId !== null &&
            proposal.toPlayerId !== agent.playerId)
        ) {
          throw new AgentApiError(
            "illegal_action",
            409,
            "The authenticated player cannot accept this proposal",
          );
        }
        if (proposal.status !== "open") {
          throw new AgentApiError(
            "proposal_closed",
            409,
            "The trade proposal is no longer open",
          );
        }

        const orchestrator = new GameOrchestrator(
          new PostgresOrchestrationStore(this.#pool, client),
          () => now,
        );
        const result = await orchestrator.executePlayerTrade({
          gameId: agent.gameId,
          fromPlayerId: proposal.fromPlayerId,
          toPlayerId: agent.playerId,
          expectedVersion: request.expectedVersion,
          offering: proposal.offering,
          requesting: proposal.requesting,
          now,
        });
        const closed = await client.query(
          `update catanbench.trade_proposals
           set status = 'executed',
               executed_by_player_id = $3,
               executed_at = $4,
               updated_at = $4
           where game_id = $1 and id = $2 and status = 'open'`,
          [agent.gameId, proposal.id, agent.playerId, now],
        );
        if (closed.rowCount !== 1) {
          throw new AgentApiError(
            "internal_error",
            500,
            "The executed trade proposal could not be closed",
            { retryable: true },
          );
        }

        return {
          status: 200,
          body: GameCommandResponseSchema.parse({
            gameId: agent.gameId,
            version: result.state.version,
            event: await this.#getCommandEvent(
              client,
              agent.gameId,
              agent.playerId,
              result.state.version,
            ),
          }),
        };
      },
    );
  }
}
