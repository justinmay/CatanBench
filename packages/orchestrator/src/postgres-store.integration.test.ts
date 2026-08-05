import { randomBytes } from "node:crypto";

import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GameOrchestrator } from "./orchestrator";
import { PostgresOrchestrationStore } from "./postgres-store";

config({ path: "../../.env" });
config({ path: "../../apps/web/.env" });

const runDatabaseTests =
  process.env.CATANBENCH_RUN_DB_TESTS === "1" &&
  Boolean(process.env.DATABASE_URL);
const databaseDescribe = runDatabaseTests ? describe : describe.skip;

databaseDescribe("PostgresOrchestrationStore", () => {
  const gameId = `test_${randomBytes(6).toString("hex")}`;
  const playerIds = ["a", "b", "c"].map((suffix) => `${gameId}_${suffix}`);
  const startedAt = new Date("2026-08-04T16:00:00.000Z");
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query(
      `insert into catanbench.games
        (id, status, state_version, turn_number, player_limit,
         turn_timeout_seconds, victory_points_to_win, seed)
       values ($1, 'lobby', 0, 0, 3, 20, 10, $2)`,
      [gameId, `seed_${gameId}`],
    );
    for (const [seat, playerId] of playerIds.entries()) {
      await pool.query(
        `insert into catanbench.players (id, game_id, seat, name, color)
         values ($1, $2, $3, $4, $5)`,
        [
          playerId,
          gameId,
          seat,
          `Agent ${seat + 1}`,
          ["red", "blue", "white"][seat],
        ],
      );
    }
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

  it("persists a start and atomically advances an expired setup turn", async () => {
    const orchestrator = new GameOrchestrator(
      new PostgresOrchestrationStore(pool),
      () => startedAt,
    );

    const initial = await orchestrator.startGame(gameId);
    expect(initial.version).toBe(0);

    const batch = await orchestrator.claimAndAdvanceExpired({
      workerId: "integration-worker",
      now: new Date(startedAt.getTime() + 20_000),
    });
    expect(batch).toMatchObject({
      claimedGameIds: [gameId],
      advancedGameIds: [gameId],
      advancedActionCount: 2,
      failures: [],
    });

    const gameResult = await pool.query<{
      state_version: number;
      active_player_id: string;
      deadline_claimed_by: string | null;
    }>(
      `select state_version, active_player_id, deadline_claimed_by
       from catanbench.games where id = $1`,
      [gameId],
    );
    expect(gameResult.rows[0]).toEqual({
      state_version: 2,
      active_player_id: playerIds[1],
      deadline_claimed_by: null,
    });

    const snapshotCount = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from catanbench.game_snapshots where game_id = $1`,
      [gameId],
    );
    expect(snapshotCount.rows[0]?.count).toBe(3);
  });
});
