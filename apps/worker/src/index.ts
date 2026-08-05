import { createDatabase } from "@catanbench/db";
import { GameOrchestrator } from "@catanbench/orchestrator";
import { PostgresOrchestrationStore } from "@catanbench/orchestrator/postgres";
import { config } from "dotenv";

config({ path: "../../.env" });
config({ path: "../web/.env" });

const workerId = process.env.CATANBENCH_WORKER_ID ?? "local-worker";
const pollIntervalMs = Number(process.env.TURN_WORKER_POLL_MS ?? 1_000);
const leaseDurationMs = Number(process.env.TURN_WORKER_LEASE_MS ?? 10_000);
const batchSize = Number(process.env.TURN_WORKER_BATCH_SIZE ?? 10);

if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error("TURN_WORKER_POLL_MS must be a positive integer");
}
if (!Number.isInteger(leaseDurationMs) || leaseDurationMs <= 0) {
  throw new Error("TURN_WORKER_LEASE_MS must be a positive integer");
}
if (!Number.isInteger(batchSize) || batchSize <= 0) {
  throw new Error("TURN_WORKER_BATCH_SIZE must be a positive integer");
}

const { pool } = createDatabase();
const orchestrator = new GameOrchestrator(new PostgresOrchestrationStore(pool));
let timer: NodeJS.Timeout | undefined;
let activePoll: Promise<void> | undefined;
let stopping = false;

async function poll() {
  try {
    const result = await orchestrator.claimAndAdvanceExpired({
      workerId,
      batchSize,
      leaseDurationMs,
    });
    if (result.advancedGameIds.length > 0) {
      console.info(
        `[${workerId}] advanced ${result.advancedActionCount} fallback actions across ${result.advancedGameIds.length} games`,
      );
    }
    for (const failure of result.failures) {
      console.error(
        `[${workerId}] failed to advance ${failure.gameId}: ${failure.message}`,
      );
    }
  } catch (error) {
    console.error(`[${workerId}] deadline poll failed`, error);
  } finally {
    if (!stopping) {
      timer = setTimeout(() => {
        activePoll = poll();
      }, pollIntervalMs);
    }
  }
}

async function shutdown(signal: string) {
  if (stopping) {
    return;
  }

  stopping = true;
  if (timer) {
    clearTimeout(timer);
  }

  console.info(`[${workerId}] received ${signal}; shutting down`);
  await activePoll;
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.info(
  `[${workerId}] deadline worker ready; polling every ${pollIntervalMs}ms`,
);
activePoll = poll();
