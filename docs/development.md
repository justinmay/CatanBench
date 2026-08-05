# CatanBench development

## Prerequisites

- Node.js 24 or newer
- pnpm 11
- Docker with Compose

## Local setup

```bash
cp .env.example .env
pnpm install
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

The control room is available at `http://127.0.0.1:3000`. Database commands and
the worker read `DATABASE_URL` from the root `.env`, falling back to
`apps/web/.env`. The default local PostgreSQL connection is configured in both
example files. An externally hosted PostgreSQL URL can be used instead of the
local container.

For Supabase, use the direct connection or session pooler for migrations and
keep the database name at its default `postgres`. CatanBench tables are created
in the private `catanbench` schema rather than `public`.

Run the deadline worker in a second terminal:

```bash
pnpm dev:worker
```

## Checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm db:check
```

## Database changes

Edit the schema in `packages/db/src/schema.ts`, then generate and inspect a SQL
migration:

```bash
pnpm db:generate
pnpm db:check
```

Commit both the TypeScript schema and the generated files under
`packages/db/drizzle`.
