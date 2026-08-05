CREATE SCHEMA "catanbench";
--> statement-breakpoint
CREATE TYPE "catanbench"."event_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "catanbench"."game_status" AS ENUM('lobby', 'initial_placement', 'active', 'paused', 'finished', 'stopped');--> statement-breakpoint
CREATE TYPE "catanbench"."player_color" AS ENUM('red', 'blue', 'white', 'orange');--> statement-breakpoint
CREATE TYPE "catanbench"."trade_proposal_status" AS ENUM('open', 'executed', 'expired');--> statement-breakpoint
CREATE TYPE "catanbench"."turn_phase" AS ENUM('place_initial_settlement', 'place_initial_road', 'roll', 'discard', 'move_robber', 'main', 'finished');--> statement-breakpoint
CREATE TABLE "catanbench"."agent_credentials" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"game_id" varchar(32) NOT NULL,
	"player_id" varchar(32) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "catanbench"."chat_messages" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"game_id" varchar(32) NOT NULL,
	"player_id" varchar(32) NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catanbench"."game_events" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"game_id" varchar(32) NOT NULL,
	"version" integer NOT NULL,
	"sequence" smallint DEFAULT 0 NOT NULL,
	"type" varchar(80) NOT NULL,
	"actor_player_id" varchar(32),
	"visibility" "catanbench"."event_visibility" DEFAULT 'public' NOT NULL,
	"visible_to_player_id" varchar(32),
	"payload" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_events_version_nonnegative" CHECK ("catanbench"."game_events"."version" >= 0),
	CONSTRAINT "game_events_sequence_nonnegative" CHECK ("catanbench"."game_events"."sequence" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catanbench"."game_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "catanbench"."game_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"game_id" varchar(32) NOT NULL,
	"version" integer NOT NULL,
	"state" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_snapshots_version_nonnegative" CHECK ("catanbench"."game_snapshots"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catanbench"."games" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"status" "catanbench"."game_status" DEFAULT 'lobby' NOT NULL,
	"state_version" integer DEFAULT 0 NOT NULL,
	"turn_number" integer DEFAULT 0 NOT NULL,
	"phase" "catanbench"."turn_phase",
	"active_player_id" varchar(32),
	"required_actor_player_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turn_started_at" timestamp (3) with time zone,
	"turn_deadline_at" timestamp (3) with time zone,
	"deadline_claimed_by" varchar(128),
	"deadline_claimed_until" timestamp (3) with time zone,
	"winner_player_id" varchar(32),
	"player_limit" smallint DEFAULT 4 NOT NULL,
	"turn_timeout_seconds" integer DEFAULT 20 NOT NULL,
	"victory_points_to_win" smallint DEFAULT 10 NOT NULL,
	"seed" varchar(128) NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone,
	"stopped_at" timestamp (3) with time zone,
	CONSTRAINT "games_state_version_nonnegative" CHECK ("catanbench"."games"."state_version" >= 0),
	CONSTRAINT "games_turn_number_nonnegative" CHECK ("catanbench"."games"."turn_number" >= 0),
	CONSTRAINT "games_player_limit_between_three_and_four" CHECK ("catanbench"."games"."player_limit" BETWEEN 3 AND 4),
	CONSTRAINT "games_turn_timeout_seconds_positive" CHECK ("catanbench"."games"."turn_timeout_seconds" > 0),
	CONSTRAINT "games_victory_points_to_win_positive" CHECK ("catanbench"."games"."victory_points_to_win" > 0)
);
--> statement-breakpoint
CREATE TABLE "catanbench"."idempotency_keys" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "catanbench"."idempotency_keys_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"game_id" varchar(32) NOT NULL,
	"player_id" varchar(32),
	"scope" varchar(80) NOT NULL,
	"key" varchar(255) NOT NULL,
	"request_hash" varchar(128) NOT NULL,
	"response_status" smallint,
	"response_body" jsonb,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "catanbench"."players" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"game_id" varchar(32) NOT NULL,
	"seat" smallint NOT NULL,
	"name" varchar(80) NOT NULL,
	"color" "catanbench"."player_color" NOT NULL,
	"resource_count" integer DEFAULT 0 NOT NULL,
	"development_card_count" integer DEFAULT 0 NOT NULL,
	"public_victory_points" smallint DEFAULT 0 NOT NULL,
	"played_knights" smallint DEFAULT 0 NOT NULL,
	"roads_remaining" smallint DEFAULT 15 NOT NULL,
	"settlements_remaining" smallint DEFAULT 5 NOT NULL,
	"cities_remaining" smallint DEFAULT 4 NOT NULL,
	"registered_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_seat_nonnegative" CHECK ("catanbench"."players"."seat" >= 0)
);
--> statement-breakpoint
CREATE TABLE "catanbench"."trade_proposals" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"game_id" varchar(32) NOT NULL,
	"created_at_version" integer NOT NULL,
	"from_player_id" varchar(32) NOT NULL,
	"to_player_id" varchar(32),
	"offering" jsonb NOT NULL,
	"requesting" jsonb NOT NULL,
	"status" "catanbench"."trade_proposal_status" DEFAULT 'open' NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"executed_by_player_id" varchar(32),
	"executed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_proposals_created_version_nonnegative" CHECK ("catanbench"."trade_proposals"."created_at_version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catanbench"."agent_credentials" ADD CONSTRAINT "agent_credentials_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "catanbench"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."agent_credentials" ADD CONSTRAINT "agent_credentials_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "catanbench"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."chat_messages" ADD CONSTRAINT "chat_messages_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "catanbench"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."chat_messages" ADD CONSTRAINT "chat_messages_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "catanbench"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."game_events" ADD CONSTRAINT "game_events_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "catanbench"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."game_events" ADD CONSTRAINT "game_events_actor_player_id_players_id_fk" FOREIGN KEY ("actor_player_id") REFERENCES "catanbench"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."game_events" ADD CONSTRAINT "game_events_visible_to_player_id_players_id_fk" FOREIGN KEY ("visible_to_player_id") REFERENCES "catanbench"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."game_snapshots" ADD CONSTRAINT "game_snapshots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "catanbench"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "catanbench"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "catanbench"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."players" ADD CONSTRAINT "players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "catanbench"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."trade_proposals" ADD CONSTRAINT "trade_proposals_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "catanbench"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."trade_proposals" ADD CONSTRAINT "trade_proposals_from_player_id_players_id_fk" FOREIGN KEY ("from_player_id") REFERENCES "catanbench"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."trade_proposals" ADD CONSTRAINT "trade_proposals_to_player_id_players_id_fk" FOREIGN KEY ("to_player_id") REFERENCES "catanbench"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catanbench"."trade_proposals" ADD CONSTRAINT "trade_proposals_executed_by_player_id_players_id_fk" FOREIGN KEY ("executed_by_player_id") REFERENCES "catanbench"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_player_uidx" ON "catanbench"."agent_credentials" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_credentials_token_hash_uidx" ON "catanbench"."agent_credentials" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_credentials_game_idx" ON "catanbench"."agent_credentials" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "chat_messages_game_created_idx" ON "catanbench"."chat_messages" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "game_events_game_version_sequence_uidx" ON "catanbench"."game_events" USING btree ("game_id","version","sequence");--> statement-breakpoint
CREATE INDEX "game_events_game_created_idx" ON "catanbench"."game_events" USING btree ("game_id","created_at");--> statement-breakpoint
CREATE INDEX "game_events_visible_to_player_idx" ON "catanbench"."game_events" USING btree ("visible_to_player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_snapshots_game_version_uidx" ON "catanbench"."game_snapshots" USING btree ("game_id","version");--> statement-breakpoint
CREATE INDEX "games_status_idx" ON "catanbench"."games" USING btree ("status");--> statement-breakpoint
CREATE INDEX "games_expired_deadline_idx" ON "catanbench"."games" USING btree ("status","turn_deadline_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_game_scope_key_uidx" ON "catanbench"."idempotency_keys" USING btree ("game_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "catanbench"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "players_game_seat_uidx" ON "catanbench"."players" USING btree ("game_id","seat");--> statement-breakpoint
CREATE UNIQUE INDEX "players_game_name_uidx" ON "catanbench"."players" USING btree ("game_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "players_game_color_uidx" ON "catanbench"."players" USING btree ("game_id","color");--> statement-breakpoint
CREATE INDEX "players_game_idx" ON "catanbench"."players" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "trade_proposals_game_status_idx" ON "catanbench"."trade_proposals" USING btree ("game_id","status");--> statement-breakpoint
CREATE INDEX "trade_proposals_open_expiry_idx" ON "catanbench"."trade_proposals" USING btree ("status","expires_at");