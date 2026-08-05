import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema";

export function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  return databaseUrl;
}

export function createDatabase(config: PoolConfig = {}) {
  const pool = new Pool({
    connectionString: config.connectionString ?? getDatabaseUrl(),
    ...config,
  });
  const db = drizzle({ client: pool, schema });

  return { db, pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];

export * from "./schema";
