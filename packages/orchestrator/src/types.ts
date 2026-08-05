import type {
  EngineEvent,
  EnginePlayerInput,
  EngineResult,
  EngineState,
  GameAction,
} from "@catanbench/engine";
import type { ResourceMap } from "@catanbench/protocol";

export type PersistedGameStatus =
  "lobby" | "initial_placement" | "active" | "paused" | "finished" | "stopped";

export interface StoredGame {
  id: string;
  status: PersistedGameStatus;
  stateVersion: number;
  turnTimeoutSeconds: number;
  victoryPointsToWin: number;
  playerLimit: number;
  seed: string;
  turnStartedAt: Date | null;
  turnDeadlineAt: Date | null;
  deadlineClaimedBy: string | null;
  deadlineClaimedUntil: Date | null;
  players: EnginePlayerInput[];
  state: EngineState | null;
}

export interface SaveStateInput {
  previousState: EngineState | null;
  state: EngineState;
  events: EngineEvent[];
  turnStartedAt: Date | null;
  turnDeadlineAt: Date | null;
  now: Date;
}

export interface StoredTradeProposal {
  id: string;
  gameId: string;
  createdAtVersion: number;
  fromPlayerId: string;
  toPlayerId: string | null;
  offering: ResourceMap;
  requesting: ResourceMap;
  expiresAt: Date;
  createdAt: Date;
}

export interface GameSession {
  game: StoredGame;
  saveState(input: SaveStateInput): Promise<void>;
  saveStatus(status: PersistedGameStatus, now: Date): Promise<void>;
  saveTradeProposal(proposal: StoredTradeProposal): Promise<void>;
  releaseDeadlineClaim(workerId: string): Promise<boolean>;
}

export interface ClaimExpiredGamesInput {
  workerId: string;
  now: Date;
  leaseUntil: Date;
  limit: number;
}

export interface OrchestrationStore {
  withGameLock<T>(
    gameId: string,
    operation: (session: GameSession) => Promise<T>,
  ): Promise<T>;
  claimExpiredGames(input: ClaimExpiredGamesInput): Promise<string[]>;
}

export interface SubmitActionInput {
  gameId: string;
  playerId: string;
  expectedVersion: number;
  action: GameAction;
  now?: Date;
}

export interface ExecutePlayerTradeInput {
  gameId: string;
  fromPlayerId: string;
  toPlayerId: string;
  expectedVersion: number;
  offering: ResourceMap;
  requesting: ResourceMap;
  now?: Date;
}

export interface CreatePlayerTradeProposalInput {
  gameId: string;
  proposalId: string;
  fromPlayerId: string;
  toPlayerId: string | null;
  expectedVersion: number;
  offering: ResourceMap;
  requesting: ResourceMap;
  now?: Date;
}

export interface CreatePlayerTradeProposalResult extends EngineResult {
  proposal: StoredTradeProposal;
}

export interface DeadlineBatchInput {
  workerId: string;
  now?: Date;
  batchSize?: number;
  leaseDurationMs?: number;
}

export interface LifecycleCommandInput {
  gameId: string;
  expectedVersion: number;
  now?: Date;
}

export interface DeadlineBatchResult {
  claimedGameIds: string[];
  advancedGameIds: string[];
  advancedActionCount: number;
  failures: Array<{ gameId: string; message: string }>;
}

export type OrchestrationErrorCode =
  | "game_not_found"
  | "invalid_game_status"
  | "invalid_game_configuration"
  | "stale_state"
  | "not_your_turn"
  | "illegal_action"
  | "deadline_not_due"
  | "deadline_claim_lost"
  | "invalid_snapshot";

export class OrchestrationError extends Error {
  readonly code: OrchestrationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: OrchestrationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OrchestrationError";
    this.code = code;
    this.details = details;
  }
}

export class StoredGameNotFoundError extends Error {
  constructor(gameId: string) {
    super(`Game not found: ${gameId}`);
    this.name = "StoredGameNotFoundError";
  }
}
