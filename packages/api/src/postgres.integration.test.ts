import { randomBytes } from "node:crypto";

import { createGame } from "@catanbench/engine";
import {
  CreateTradeProposalResponseSchema,
  PostChatMessageResponseSchema,
  RegisterAgentResponseSchema,
  type RegisterAgentResponse,
} from "@catanbench/protocol";
import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTradeProposalHttp,
  executeTradeHttp,
  getChatMessagesHttp,
  getGameStateHttp,
  getTradeProposalsHttp,
  postChatMessageHttp,
  registerAgentHttp,
  submitActionHttp,
} from "./http";
import { AgentApi } from "./service";

config({ path: "../../.env" });
config({ path: "../../apps/web/.env" });

const runDatabaseTests =
  process.env.CATANBENCH_RUN_DB_TESTS === "1" &&
  Boolean(process.env.DATABASE_URL);
const databaseDescribe = runDatabaseTests ? describe : describe.skip;

function postRequest(
  url: string,
  body: unknown,
  key: string,
  token?: string,
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getRequest(url: string, token: string): Request {
  return new Request(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

databaseDescribe("Postgres agent API", () => {
  const gameId = `test_api_${randomBytes(6).toString("hex")}`;
  const now = new Date();
  let pool: Pool;
  let api: AgentApi;
  const agents: RegisterAgentResponse[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    api = new AgentApi(pool, () => now);
    await pool.query(
      `insert into catanbench.games
        (id, status, state_version, turn_number, player_limit,
         turn_timeout_seconds, victory_points_to_win, seed)
       values ($1, 'lobby', 0, 0, 3, 20, 10, $2)`,
      [gameId, `seed_${gameId}`],
    );
  });

  afterAll(async () => {
    if (pool) {
      const cleanup = await pool.query(
        "delete from catanbench.games where id = $1",
        [gameId],
      );
      if (cleanup.rowCount !== 1) {
        throw new Error(`Failed to remove integration game ${gameId}`);
      }
      await pool.end();
    }
  });

  it("serves registration, state, chat, trades, and actions end to end", async () => {
    for (const [index, name] of ["Alpha", "Beta", "Gamma"].entries()) {
      const response = await registerAgentHttp(
        api,
        postRequest(
          `http://localhost/api/v1/games/${gameId}/agents/register`,
          { name },
          `register-${index}`,
        ),
        gameId,
      );
      expect(response.status).toBe(201);
      agents.push(RegisterAgentResponseSchema.parse(await response.json()));
    }

    const replay = await registerAgentHttp(
      api,
      postRequest(
        `http://localhost/api/v1/games/${gameId}/agents/register`,
        { name: "Alpha" },
        "register-0",
      ),
      gameId,
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(agents[0]);

    const lobby = await getGameStateHttp(
      api,
      getRequest(
        `http://localhost/api/v1/games/${gameId}/state`,
        agents[0]!.token,
      ),
      gameId,
    );
    expect(lobby.status).toBe(200);
    await expect(lobby.json()).resolves.toMatchObject({
      game: { status: "lobby", version: 0 },
      you: { playerId: agents[0]!.playerId },
    });

    const state = createGame({
      gameId,
      seed: `seed_${gameId}`,
      players: agents.map((agent, seat) => ({
        id: agent.playerId,
        seat,
        name: ["Alpha", "Beta", "Gamma"][seat]!,
        color: agent.color,
      })),
    });
    state.status = "active";
    state.turnNumber = 1;
    state.turn.phase = "main";
    state.turn.activePlayerId = agents[0]!.playerId;
    state.turn.requiredActorPlayerIds = [agents[0]!.playerId];
    state.dice = { values: [3, 5], total: 8 };
    state.players[0]!.resources.brick = 1;
    state.players[1]!.resources.ore = 1;
    const deadline = new Date(now.getTime() + 60_000);
    const setupClient = await pool.connect();
    try {
      await setupClient.query("begin");
      await setupClient.query(
        `update catanbench.games
         set status = 'active', turn_number = 1, phase = 'main',
             active_player_id = $2, required_actor_player_ids = $3::jsonb,
             turn_started_at = $4, turn_deadline_at = $5, updated_at = $4
         where id = $1`,
        [
          gameId,
          agents[0]!.playerId,
          JSON.stringify([agents[0]!.playerId]),
          now,
          deadline,
        ],
      );
      await setupClient.query(
        `insert into catanbench.game_snapshots (game_id, version, state, created_at)
         values ($1, 0, $2::jsonb, $3)`,
        [gameId, JSON.stringify(state), now],
      );
      await setupClient.query("commit");
    } catch (error) {
      await setupClient.query("rollback");
      throw error;
    } finally {
      setupClient.release();
    }

    const chat = await postChatMessageHttp(
      api,
      postRequest(
        `http://localhost/api/v1/games/${gameId}/chat`,
        { message: "One brick for one ore?" },
        "chat-1",
        agents[0]!.token,
      ),
      gameId,
    );
    expect(chat.status).toBe(201);
    const postedChat = PostChatMessageResponseSchema.parse(await chat.json());
    const messages = await getChatMessagesHttp(
      api,
      getRequest(
        `http://localhost/api/v1/games/${gameId}/chat`,
        agents[1]!.token,
      ),
      gameId,
    );
    await expect(messages.json()).resolves.toMatchObject({
      messages: [postedChat.message],
    });

    const proposalResponse = await createTradeProposalHttp(
      api,
      postRequest(
        `http://localhost/api/v1/games/${gameId}/trade-proposals`,
        {
          expectedVersion: 0,
          toPlayerId: agents[1]!.playerId,
          offering: { brick: 1, lumber: 0, ore: 0, grain: 0, wool: 0 },
          requesting: { brick: 0, lumber: 0, ore: 1, grain: 0, wool: 0 },
        },
        "proposal-1",
        agents[0]!.token,
      ),
      gameId,
    );
    expect(proposalResponse.status).toBe(201);
    const proposalBody = CreateTradeProposalResponseSchema.parse(
      await proposalResponse.json(),
    );
    expect(proposalBody.version).toBe(1);

    const visibleProposals = await getTradeProposalsHttp(
      api,
      getRequest(
        `http://localhost/api/v1/games/${gameId}/trade-proposals?status=open`,
        agents[1]!.token,
      ),
      gameId,
    );
    await expect(visibleProposals.json()).resolves.toMatchObject({
      proposals: [{ id: proposalBody.proposal.id, status: "open" }],
    });

    const executed = await executeTradeHttp(
      api,
      postRequest(
        `http://localhost/api/v1/games/${gameId}/trades/execute`,
        { expectedVersion: 1, proposalId: proposalBody.proposal.id },
        "execute-1",
        agents[1]!.token,
      ),
      gameId,
    );
    expect(executed.status).toBe(200);
    await expect(executed.json()).resolves.toMatchObject({
      version: 2,
      event: { type: "tradeExecuted" },
    });

    const actionRequest = postRequest(
      `http://localhost/api/v1/games/${gameId}/actions`,
      { expectedVersion: 2, action: { type: "endTurn" } },
      "action-1",
      agents[0]!.token,
    );
    const action = await submitActionHttp(api, actionRequest, gameId);
    expect(action.status).toBe(200);
    await expect(action.clone().json()).resolves.toMatchObject({
      version: 3,
      event: { type: "turnEnded" },
    });

    const actionReplay = await submitActionHttp(
      api,
      postRequest(
        `http://localhost/api/v1/games/${gameId}/actions`,
        { expectedVersion: 2, action: { type: "endTurn" } },
        "action-1",
        agents[0]!.token,
      ),
      gameId,
    );
    expect(actionReplay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await actionReplay.json()).toEqual(await action.json());

    const finalState = await getGameStateHttp(
      api,
      getRequest(
        `http://localhost/api/v1/games/${gameId}/state`,
        agents[1]!.token,
      ),
      gameId,
    );
    await expect(finalState.json()).resolves.toMatchObject({
      game: { version: 3 },
      you: { resources: { brick: 1, ore: 0 } },
    });
  }, 30_000);
});
