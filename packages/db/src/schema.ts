import type { ResourceMap } from "@catanbench/protocol";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

const id = (name: string) => varchar(name, { length: 32 });
const timestampColumn = (name: string) =>
  timestamp(name, { mode: "date", precision: 3, withTimezone: true });

export const catanbenchSchema = pgSchema("catanbench");

export const gameStatusEnum = catanbenchSchema.enum("game_status", [
  "lobby",
  "initial_placement",
  "active",
  "paused",
  "finished",
  "stopped",
]);

export const turnPhaseEnum = catanbenchSchema.enum("turn_phase", [
  "place_initial_settlement",
  "place_initial_road",
  "roll",
  "discard",
  "move_robber",
  "main",
  "finished",
]);

export const playerColorEnum = catanbenchSchema.enum("player_color", [
  "red",
  "blue",
  "white",
  "orange",
]);

export const eventVisibilityEnum = catanbenchSchema.enum("event_visibility", [
  "public",
  "private",
]);

export const tradeProposalStatusEnum = catanbenchSchema.enum(
  "trade_proposal_status",
  ["open", "executed", "expired"],
);

export const games = catanbenchSchema.table(
  "games",
  {
    id: id("id").primaryKey(),
    status: gameStatusEnum("status").default("lobby").notNull(),
    stateVersion: integer("state_version").default(0).notNull(),
    turnNumber: integer("turn_number").default(0).notNull(),
    phase: turnPhaseEnum("phase"),
    activePlayerId: id("active_player_id"),
    requiredActorPlayerIds: jsonb("required_actor_player_ids")
      .$type<string[]>()
      .default([])
      .notNull(),
    turnStartedAt: timestampColumn("turn_started_at"),
    turnDeadlineAt: timestampColumn("turn_deadline_at"),
    deadlineClaimedBy: varchar("deadline_claimed_by", { length: 128 }),
    deadlineClaimedUntil: timestampColumn("deadline_claimed_until"),
    winnerPlayerId: id("winner_player_id"),
    playerLimit: smallint("player_limit").default(4).notNull(),
    turnTimeoutSeconds: integer("turn_timeout_seconds").default(20).notNull(),
    victoryPointsToWin: smallint("victory_points_to_win").default(10).notNull(),
    seed: varchar("seed", { length: 128 }).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
    finishedAt: timestampColumn("finished_at"),
    stoppedAt: timestampColumn("stopped_at"),
  },
  (table) => [
    check("games_state_version_nonnegative", sql`${table.stateVersion} >= 0`),
    check("games_turn_number_nonnegative", sql`${table.turnNumber} >= 0`),
    check(
      "games_player_limit_between_three_and_four",
      sql`${table.playerLimit} BETWEEN 3 AND 4`,
    ),
    check(
      "games_turn_timeout_seconds_positive",
      sql`${table.turnTimeoutSeconds} > 0`,
    ),
    check(
      "games_victory_points_to_win_positive",
      sql`${table.victoryPointsToWin} > 0`,
    ),
    index("games_status_idx").on(table.status),
    index("games_expired_deadline_idx").on(table.status, table.turnDeadlineAt),
  ],
);

export const players = catanbenchSchema.table(
  "players",
  {
    id: id("id").primaryKey(),
    gameId: id("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    seat: smallint("seat").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    color: playerColorEnum("color").notNull(),
    resourceCount: integer("resource_count").default(0).notNull(),
    developmentCardCount: integer("development_card_count")
      .default(0)
      .notNull(),
    publicVictoryPoints: smallint("public_victory_points").default(0).notNull(),
    playedKnights: smallint("played_knights").default(0).notNull(),
    roadsRemaining: smallint("roads_remaining").default(15).notNull(),
    settlementsRemaining: smallint("settlements_remaining")
      .default(5)
      .notNull(),
    citiesRemaining: smallint("cities_remaining").default(4).notNull(),
    registeredAt: timestampColumn("registered_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("players_game_seat_uidx").on(table.gameId, table.seat),
    uniqueIndex("players_game_name_uidx").on(table.gameId, table.name),
    uniqueIndex("players_game_color_uidx").on(table.gameId, table.color),
    index("players_game_idx").on(table.gameId),
    check("players_seat_nonnegative", sql`${table.seat} >= 0`),
  ],
);

export const agentCredentials = catanbenchSchema.table(
  "agent_credentials",
  {
    id: id("id").primaryKey(),
    gameId: id("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: id("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    lastUsedAt: timestampColumn("last_used_at"),
    revokedAt: timestampColumn("revoked_at"),
  },
  (table) => [
    uniqueIndex("agent_credentials_player_uidx").on(table.playerId),
    uniqueIndex("agent_credentials_token_hash_uidx").on(table.tokenHash),
    index("agent_credentials_game_idx").on(table.gameId),
  ],
);

export const gameSnapshots = catanbenchSchema.table(
  "game_snapshots",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    gameId: id("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    state: jsonb("state").$type<Record<string, unknown>>().notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("game_snapshots_game_version_uidx").on(
      table.gameId,
      table.version,
    ),
    check("game_snapshots_version_nonnegative", sql`${table.version} >= 0`),
  ],
);

export const gameEvents = catanbenchSchema.table(
  "game_events",
  {
    id: id("id").primaryKey(),
    gameId: id("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sequence: smallint("sequence").default(0).notNull(),
    type: varchar("type", { length: 80 }).notNull(),
    actorPlayerId: id("actor_player_id").references(() => players.id, {
      onDelete: "set null",
    }),
    visibility: eventVisibilityEnum("visibility").default("public").notNull(),
    visibleToPlayerId: id("visible_to_player_id").references(() => players.id, {
      onDelete: "cascade",
    }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("game_events_game_version_sequence_uidx").on(
      table.gameId,
      table.version,
      table.sequence,
    ),
    index("game_events_game_created_idx").on(table.gameId, table.createdAt),
    index("game_events_visible_to_player_idx").on(table.visibleToPlayerId),
    check("game_events_version_nonnegative", sql`${table.version} >= 0`),
    check("game_events_sequence_nonnegative", sql`${table.sequence} >= 0`),
  ],
);

export const chatMessages = catanbenchSchema.table(
  "chat_messages",
  {
    id: id("id").primaryKey(),
    gameId: id("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: id("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("chat_messages_game_created_idx").on(table.gameId, table.createdAt),
  ],
);

export const tradeProposals = catanbenchSchema.table(
  "trade_proposals",
  {
    id: id("id").primaryKey(),
    gameId: id("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    createdAtVersion: integer("created_at_version").notNull(),
    fromPlayerId: id("from_player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    toPlayerId: id("to_player_id").references(() => players.id, {
      onDelete: "cascade",
    }),
    offering: jsonb("offering").$type<ResourceMap>().notNull(),
    requesting: jsonb("requesting").$type<ResourceMap>().notNull(),
    status: tradeProposalStatusEnum("status").default("open").notNull(),
    expiresAt: timestampColumn("expires_at").notNull(),
    executedByPlayerId: id("executed_by_player_id").references(
      () => players.id,
      { onDelete: "set null" },
    ),
    executedAt: timestampColumn("executed_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("trade_proposals_game_status_idx").on(table.gameId, table.status),
    index("trade_proposals_open_expiry_idx").on(table.status, table.expiresAt),
    check(
      "trade_proposals_created_version_nonnegative",
      sql`${table.createdAtVersion} >= 0`,
    ),
  ],
);

export const idempotencyKeys = catanbenchSchema.table(
  "idempotency_keys",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    gameId: id("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    playerId: id("player_id").references(() => players.id, {
      onDelete: "cascade",
    }),
    scope: varchar("scope", { length: 80 }).notNull(),
    key: varchar("key", { length: 255 }).notNull(),
    requestHash: varchar("request_hash", { length: 128 }).notNull(),
    responseStatus: smallint("response_status"),
    responseBody: jsonb("response_body").$type<Record<string, unknown>>(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    expiresAt: timestampColumn("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("idempotency_keys_game_scope_key_uidx").on(
      table.gameId,
      table.scope,
      table.key,
    ),
    index("idempotency_keys_expiry_idx").on(table.expiresAt),
  ],
);
