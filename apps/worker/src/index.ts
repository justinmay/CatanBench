import { createDatabase } from "@catanbench/db";
import { config } from "dotenv";

config({ path: "../../.env" });
config({ path: "../web/.env" });

const workerId = process.env.CATANBENCH_WORKER_ID ?? "local-worker";
const pollIntervalMs = Number(process.env.TURN_WORKER_POLL_MS ?? 1_000);

if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error("TURN_WORKER_POLL_MS must be a positive integer");
}

const { pool } = createDatabase();
let timer: NodeJS.Timeout | undefined;
let stopping = false;

async function poll() {
  try {
    await pool.query("select 1");
  } catch (error) {
    console.error(`[${workerId}] database poll failed`, error);
  } finally {
    if (!stopping) {
      timer = setTimeout(poll, pollIntervalMs);
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
  await pool.end();
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

console.info(
  `[${workerId}] worker scaffold ready; polling every ${pollIntervalMs}ms`,
);
void poll();
