import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: "../../.env" });
config({ path: "../../apps/web/.env" });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://catanbench:catanbench@127.0.0.1:5432/catanbench",
  },
  migrations: {
    table: "migrations",
    schema: "drizzle",
  },
  strict: true,
});
