import { config } from "dotenv";
import { Pool } from "pg";

config({ path: "../../.env" });
config({ path: "../../apps/web/.env" });

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString, connectionTimeoutMillis: 10_000 });

try {
  const result = await pool.query<{
    schema_present: boolean;
    table_count: number;
  }>(
    `select
      to_regclass('catanbench.games') is not null as schema_present,
      (
        select count(*)::int
        from information_schema.tables
        where table_schema = 'catanbench'
          and table_type = 'BASE TABLE'
      ) as table_count`,
  );

  console.info(
    JSON.stringify({
      connected: true,
      schemaPresent: result.rows[0]?.schema_present ?? false,
      tableCount: result.rows[0]?.table_count ?? 0,
    }),
  );
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Unknown database error";
  console.error(JSON.stringify({ connected: false, message }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
