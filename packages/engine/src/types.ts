import type {
  Board,
  DevelopmentCardType,
  GameAction,
  LegalAction,
  PlayerColor,
  ResourceMap,
  TurnPhase,
} from "@catanbench/protocol";

export interface EnginePlayerInput {
  id: string;
  seat: number;
  name: string;
  color: PlayerColor;
}

export interface EngineDevelopmentCard {
  id: string;
  type: DevelopmentCardType;
  purchasedTurn: number;
  played: boolean;
}

export interface EnginePlayer extends EnginePlayerInput {
  resources: ResourceMap;
  developmentCards: EngineDevelopmentCard[];
  playedKnights: number;
  roadsRemaining: number;
  settlementsRemaining: number;
  citiesRemaining: number;
}

export interface EngineTurn {
  activePlayerId: string;
  phase: TurnPhase;
  requiredActorPlayerIds: string[];
  developmentCardPlayed: boolean;
  initialPlacementIndex: number;
  initialSettlementVertexId: string | null;
  discardRequirements: Record<string, number>;
}

export interface EngineAwards {
  longestRoad: {
    playerId: string | null;
    length: number;
  };
  largestArmy: {
    playerId: string | null;
    size: number;
  };
}

export interface EngineDice {
  values: [number, number];
  total: number;
}

export type EngineGameStatus =
  "initial_placement" | "active" | "paused" | "finished" | "stopped";

export interface EngineState {
  gameId: string;
  status: EngineGameStatus;
  version: number;
  turnNumber: number;
  victoryPointsToWin: number;
  winnerPlayerId: string | null;
  seed: string;
  rngState: number;
  playerOrder: string[];
  setupOrder: string[];
  players: EnginePlayer[];
  board: Board;
  bank: ResourceMap;
  developmentDeck: DevelopmentCardType[];
  nextDevelopmentCardId: number;
  turn: EngineTurn;
  dice: EngineDice | null;
  awards: EngineAwards;
}

export interface EngineEvent {
  type: string;
  actorPlayerId: string | null;
  visibility: "public" | "private";
  visibleToPlayerId?: string;
  data: Record<string, unknown>;
}

export interface EngineResult {
  state: EngineState;
  events: EngineEvent[];
}

export interface CreateGameOptions {
  gameId: string;
  seed: string;
  players: EnginePlayerInput[];
  victoryPointsToWin?: number;
}

export type { GameAction, LegalAction };

export type RulesErrorCode =
  "invalid_state" | "not_your_turn" | "illegal_action";

export class RulesError extends Error {
  readonly code: RulesErrorCode;

  constructor(code: RulesErrorCode, message: string) {
    super(message);
    this.name = "RulesError";
    this.code = code;
  }
}
