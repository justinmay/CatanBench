import {
  emptyResourceMap,
  getLegalActions,
  getPublicVictoryPoints,
  getVictoryPoints,
  type EngineState,
} from "@catanbench/engine";
import {
  GameStateSchema,
  type GameState,
  type LegalAction,
  type PlayerColor,
} from "@catanbench/protocol";

export interface GameProjectionRecord {
  id: string;
  status: GameState["game"]["status"];
  stateVersion: number;
  turnNumber: number;
  turnTimeoutSeconds: number;
  victoryPointsToWin: number;
  winnerPlayerId: string | null;
  turnStartedAt: Date | null;
  turnDeadlineAt: Date | null;
}

export interface PlayerProjectionRecord {
  id: string;
  seat: number;
  name: string;
  color: PlayerColor;
  resourceCount: number;
  developmentCardCount: number;
  publicVictoryPoints: number;
  playedKnights: number;
  roadsRemaining: number;
  settlementsRemaining: number;
  citiesRemaining: number;
}

export interface ProjectGameStateInput {
  game: GameProjectionRecord;
  playerId: string;
  players: PlayerProjectionRecord[];
  state: EngineState | null;
  recentEvents: GameState["recentEvents"];
  serverTime: Date;
}

const LOBBY_BANK = {
  brick: 19,
  lumber: 19,
  ore: 19,
  grain: 19,
  wool: 19,
} as const;

function developmentActionType(type: string): LegalAction["type"] | null {
  switch (type) {
    case "knight":
      return "playKnight";
    case "monopoly":
      return "playMonopoly";
    case "year_of_plenty":
      return "playYearOfPlenty";
    case "road_building":
      return "playRoadBuilding";
    default:
      return null;
  }
}

export function projectGameState(input: ProjectGameStateInput): GameState {
  const { game, playerId, state } = input;
  const storedPlayer = input.players.find((player) => player.id === playerId);
  if (!storedPlayer) {
    throw new Error(`Player ${playerId} is missing from game ${game.id}`);
  }

  if (!state) {
    return GameStateSchema.parse({
      game: {
        id: game.id,
        status: game.status,
        version: game.stateVersion,
        turnNumber: game.turnNumber,
        victoryPointsToWin: game.victoryPointsToWin,
        turnTimeoutSeconds: game.turnTimeoutSeconds,
        winnerPlayerId: game.winnerPlayerId,
      },
      serverTime: input.serverTime.toISOString(),
      turn: null,
      you: {
        playerId: storedPlayer.id,
        seat: storedPlayer.seat,
        name: storedPlayer.name,
        color: storedPlayer.color,
        resources: emptyResourceMap(),
        developmentCards: [],
        victoryPoints: 0,
      },
      players: input.players.map((player) => ({
        playerId: player.id,
        seat: player.seat,
        name: player.name,
        color: player.color,
        resourceCount: player.resourceCount,
        developmentCardCount: player.developmentCardCount,
        publicVictoryPoints: player.publicVictoryPoints,
        playedKnights: player.playedKnights,
        roadsRemaining: player.roadsRemaining,
        settlementsRemaining: player.settlementsRemaining,
        citiesRemaining: player.citiesRemaining,
      })),
      bank: {
        resources: LOBBY_BANK,
        developmentCardCount: 25,
      },
      board: { hexes: [], vertices: [], edges: [], ports: [] },
      dice: null,
      awards: {
        longestRoad: { playerId: null, length: 0 },
        largestArmy: { playerId: null, size: 0 },
      },
      legalActions: [],
      recentEvents: input.recentEvents,
    });
  }

  const enginePlayer = state.players.find((player) => player.id === playerId);
  if (!enginePlayer) {
    throw new Error(`Player ${playerId} is missing from the engine snapshot`);
  }
  const legalActions = getLegalActions(state, playerId);
  const legalTypes = new Set(legalActions.map((action) => action.type));
  const hasActiveTurn =
    (state.status === "initial_placement" || state.status === "active") &&
    input.game.turnStartedAt !== null &&
    input.game.turnDeadlineAt !== null;

  return GameStateSchema.parse({
    game: {
      id: game.id,
      status: game.status,
      version: state.version,
      turnNumber: state.turnNumber,
      victoryPointsToWin: state.victoryPointsToWin,
      turnTimeoutSeconds: game.turnTimeoutSeconds,
      winnerPlayerId: state.winnerPlayerId,
    },
    serverTime: input.serverTime.toISOString(),
    turn: hasActiveTurn
      ? {
          activePlayerId: state.turn.activePlayerId,
          phase: state.turn.phase,
          requiredActorPlayerIds: state.turn.requiredActorPlayerIds,
          startedAt: input.game.turnStartedAt!.toISOString(),
          deadlineAt: input.game.turnDeadlineAt!.toISOString(),
        }
      : null,
    you: {
      playerId: enginePlayer.id,
      seat: enginePlayer.seat,
      name: enginePlayer.name,
      color: enginePlayer.color,
      resources: enginePlayer.resources,
      developmentCards: enginePlayer.developmentCards
        .filter((card) => !card.played)
        .map((card) => {
          const actionType = developmentActionType(card.type);
          return {
            id: card.id,
            type: card.type,
            playable: actionType !== null && legalTypes.has(actionType),
          };
        }),
      victoryPoints: getVictoryPoints(state, playerId),
    },
    players: state.players.map((player) => ({
      playerId: player.id,
      seat: player.seat,
      name: player.name,
      color: player.color,
      resourceCount: Object.values(player.resources).reduce(
        (total, count) => total + count,
        0,
      ),
      developmentCardCount: player.developmentCards.filter(
        (card) => !card.played,
      ).length,
      publicVictoryPoints: getPublicVictoryPoints(state, player.id),
      playedKnights: player.playedKnights,
      roadsRemaining: player.roadsRemaining,
      settlementsRemaining: player.settlementsRemaining,
      citiesRemaining: player.citiesRemaining,
    })),
    bank: {
      resources: state.bank,
      developmentCardCount: state.developmentDeck.length,
    },
    board: state.board,
    dice: state.dice,
    awards: state.awards,
    legalActions,
    recentEvents: input.recentEvents,
  });
}
