import type {
  DevelopmentCardType,
  Resource,
  ResourceMap,
} from "@catanbench/protocol";

import { createStandardBoard } from "./board";
import {
  CITY_COST,
  DEVELOPMENT_CARD_COST,
  RESOURCES,
  ROAD_COST,
  SETTLEMENT_COST,
  STANDARD_DEVELOPMENT_DECK,
  TERRAIN_RESOURCE,
} from "./constants";
import {
  findPlayer,
  getLegalInitialRoadEdges,
  getLegalInitialSettlementVertices,
  getLegalRoadEdges,
  getLegalSettlementVertices,
  getMaritimeRates,
  getVictoryPoints,
  recalculateAwards,
} from "./graph";
import { hashSeed, randomInteger, shuffle } from "./random";
import {
  addResources,
  emptyResourceMap,
  hasResources,
  nonzeroResources,
  singleResourceMap,
  subtractResources,
  sumResources,
} from "./resources";
import type {
  CreateGameOptions,
  EngineDevelopmentCard,
  EngineEvent,
  EnginePlayer,
  EngineResult,
  EngineState,
  GameAction,
  LegalAction,
} from "./types";
import { RulesError } from "./types";

function publicEvent(
  type: string,
  actorPlayerId: string | null,
  data: Record<string, unknown>,
): EngineEvent {
  return { type, actorPlayerId, visibility: "public", data };
}

function privateEvent(
  type: string,
  playerId: string,
  data: Record<string, unknown>,
): EngineEvent {
  return {
    type,
    actorPlayerId: playerId,
    visibility: "private",
    visibleToPlayerId: playerId,
    data,
  };
}

function requirePlayer(state: EngineState, playerId: string): EnginePlayer {
  const player = findPlayer(state, playerId);
  if (!player) {
    throw new RulesError("invalid_state", `Unknown player: ${playerId}`);
  }
  return player;
}

function requireTurnActor(state: EngineState, playerId: string): void {
  if (!state.turn.requiredActorPlayerIds.includes(playerId)) {
    throw new RulesError(
      "not_your_turn",
      "The player cannot act in this phase",
    );
  }
}

function transferToBank(
  state: EngineState,
  player: EnginePlayer,
  cost: ResourceMap,
): void {
  if (!hasResources(player.resources, cost)) {
    throw new RulesError(
      "illegal_action",
      "The player cannot afford this action",
    );
  }
  subtractResources(player.resources, cost);
  addResources(state.bank, cost);
}

function transferFromBank(
  state: EngineState,
  player: EnginePlayer,
  resources: ResourceMap,
): void {
  if (!hasResources(state.bank, resources)) {
    throw new RulesError(
      "illegal_action",
      "The bank lacks the requested resources",
    );
  }
  subtractResources(state.bank, resources);
  addResources(player.resources, resources);
}

function playableDevelopmentCard(
  state: EngineState,
  player: EnginePlayer,
  type: DevelopmentCardType,
): EngineDevelopmentCard | undefined {
  return player.developmentCards.find(
    (card) =>
      card.type === type &&
      !card.played &&
      card.purchasedTurn < state.turnNumber,
  );
}

function victimIdsForHex(
  state: EngineState,
  hexId: string,
  movingPlayerId: string,
): string[] {
  const hex = state.board.hexes.find((candidate) => candidate.id === hexId);
  if (!hex) {
    return [];
  }

  const adjacentPlayerIds = new Set(
    state.board.vertices
      .filter((vertex) => vertex.adjacentHexIds.includes(hexId))
      .flatMap((vertex) =>
        vertex.building === null ? [] : [vertex.building.playerId],
      ),
  );

  return state.players
    .filter(
      (player) =>
        player.id !== movingPlayerId &&
        adjacentPlayerIds.has(player.id) &&
        sumResources(player.resources) > 0,
    )
    .sort((left, right) => left.seat - right.seat)
    .map((player) => player.id);
}

function canDrawTwoResources(bank: ResourceMap): boolean {
  return sumResources(bank) >= 2;
}

export function createGame(options: CreateGameOptions): EngineState {
  if (options.players.length < 3 || options.players.length > 4) {
    throw new RulesError(
      "invalid_state",
      "A game requires three or four players",
    );
  }
  if (!options.gameId || !options.seed) {
    throw new RulesError("invalid_state", "gameId and seed are required");
  }

  const sortedPlayers = [...options.players].sort(
    (left, right) => left.seat - right.seat,
  );
  const uniqueIds = new Set(sortedPlayers.map((player) => player.id));
  const uniqueSeats = new Set(sortedPlayers.map((player) => player.seat));
  const uniqueColors = new Set(sortedPlayers.map((player) => player.color));
  if (
    uniqueIds.size !== sortedPlayers.length ||
    uniqueSeats.size !== sortedPlayers.length ||
    uniqueColors.size !== sortedPlayers.length
  ) {
    throw new RulesError(
      "invalid_state",
      "Player IDs, seats, and colors must be unique",
    );
  }
  if (sortedPlayers.some((player, index) => player.seat !== index)) {
    throw new RulesError(
      "invalid_state",
      "Player seats must be contiguous and start at zero",
    );
  }

  const victoryPointsToWin = options.victoryPointsToWin ?? 10;
  if (!Number.isInteger(victoryPointsToWin) || victoryPointsToWin <= 0) {
    throw new RulesError(
      "invalid_state",
      "victoryPointsToWin must be a positive integer",
    );
  }

  const initialRngState = hashSeed(options.seed);
  const boardResult = createStandardBoard(initialRngState);
  const deckResult = shuffle(STANDARD_DEVELOPMENT_DECK, boardResult.rngState);
  const players: EnginePlayer[] = sortedPlayers.map((player) => ({
    ...player,
    resources: emptyResourceMap(),
    developmentCards: [],
    playedKnights: 0,
    roadsRemaining: 15,
    settlementsRemaining: 5,
    citiesRemaining: 4,
  }));
  const playerOrder = players.map((player) => player.id);
  const setupOrder = [...playerOrder, ...[...playerOrder].reverse()];

  return {
    gameId: options.gameId,
    status: "initial_placement",
    version: 0,
    turnNumber: 0,
    victoryPointsToWin,
    winnerPlayerId: null,
    seed: options.seed,
    rngState: deckResult.state,
    playerOrder,
    setupOrder,
    players,
    board: boardResult.board,
    bank: { brick: 19, lumber: 19, ore: 19, grain: 19, wool: 19 },
    developmentDeck: deckResult.values,
    nextDevelopmentCardId: 1,
    turn: {
      activePlayerId: setupOrder[0]!,
      phase: "place_initial_settlement",
      requiredActorPlayerIds: [setupOrder[0]!],
      developmentCardPlayed: false,
      initialPlacementIndex: 0,
      initialSettlementVertexId: null,
      discardRequirements: {},
    },
    dice: null,
    awards: {
      longestRoad: { playerId: null, length: 0 },
      largestArmy: { playerId: null, size: 0 },
    },
  };
}

export function getLegalActions(
  state: EngineState,
  playerId: string,
): LegalAction[] {
  if (
    state.status === "paused" ||
    state.status === "finished" ||
    state.status === "stopped"
  ) {
    return [];
  }
  if (!findPlayer(state, playerId)) {
    return [];
  }
  if (!state.turn.requiredActorPlayerIds.includes(playerId)) {
    return [];
  }

  const player = requirePlayer(state, playerId);
  switch (state.turn.phase) {
    case "place_initial_settlement":
      return [
        {
          type: "placeInitialSettlement",
          vertexIds: getLegalInitialSettlementVertices(state.board),
        },
      ];
    case "place_initial_road":
      return [
        {
          type: "placeInitialRoad",
          edgeIds: getLegalInitialRoadEdges(
            state.board,
            state.turn.initialSettlementVertexId!,
          ),
        },
      ];
    case "roll":
      return [{ type: "rollDice" }];
    case "discard":
      return [
        {
          type: "discardResources",
          requiredCount: state.turn.discardRequirements[playerId] ?? 0,
        },
      ];
    case "move_robber": {
      const hexIds = state.board.hexes
        .filter((hex) => !hex.hasRobber)
        .map((hex) => hex.id)
        .sort();
      const victimPlayerIds = [
        ...new Set(
          hexIds.flatMap((hexId) => victimIdsForHex(state, hexId, playerId)),
        ),
      ];
      return [{ type: "moveRobber", hexIds, victimPlayerIds }];
    }
    case "main": {
      const actions: LegalAction[] = [];
      const legalRoadEdges = getLegalRoadEdges(state, playerId);
      if (
        player.roadsRemaining > 0 &&
        legalRoadEdges.length > 0 &&
        hasResources(player.resources, ROAD_COST)
      ) {
        actions.push({ type: "buildRoad", edgeIds: legalRoadEdges });
      }

      const legalSettlementVertices = getLegalSettlementVertices(
        state,
        playerId,
      );
      if (
        player.settlementsRemaining > 0 &&
        legalSettlementVertices.length > 0 &&
        hasResources(player.resources, SETTLEMENT_COST)
      ) {
        actions.push({
          type: "buildSettlement",
          vertexIds: legalSettlementVertices,
        });
      }

      const cityVertices = state.board.vertices
        .filter(
          (vertex) =>
            vertex.building?.playerId === playerId &&
            vertex.building.type === "settlement",
        )
        .map((vertex) => vertex.id)
        .sort();
      if (
        player.citiesRemaining > 0 &&
        cityVertices.length > 0 &&
        hasResources(player.resources, CITY_COST)
      ) {
        actions.push({ type: "upgradeCity", vertexIds: cityVertices });
      }

      if (
        state.developmentDeck.length > 0 &&
        hasResources(player.resources, DEVELOPMENT_CARD_COST)
      ) {
        actions.push({ type: "buyDevelopmentCard" });
      }

      if (!state.turn.developmentCardPlayed) {
        if (playableDevelopmentCard(state, player, "knight")) {
          actions.push({ type: "playKnight" });
        }
        if (playableDevelopmentCard(state, player, "monopoly")) {
          actions.push({ type: "playMonopoly", resources: [...RESOURCES] });
        }
        if (
          playableDevelopmentCard(state, player, "year_of_plenty") &&
          canDrawTwoResources(state.bank)
        ) {
          actions.push({
            type: "playYearOfPlenty",
            resources: RESOURCES.filter((resource) => state.bank[resource] > 0),
          });
        }
        if (
          playableDevelopmentCard(state, player, "road_building") &&
          player.roadsRemaining > 0 &&
          legalRoadEdges.length > 0
        ) {
          actions.push({
            type: "playRoadBuilding",
            firstEdgeIds: legalRoadEdges,
          });
        }
      }

      const giveRates = getMaritimeRates(state.board, playerId);
      const canTrade = RESOURCES.some(
        (giveResource) =>
          player.resources[giveResource] >= giveRates[giveResource] &&
          RESOURCES.some(
            (receiveResource) =>
              receiveResource !== giveResource &&
              state.bank[receiveResource] > 0,
          ),
      );
      if (canTrade) {
        actions.push({ type: "maritimeTrade", giveRates });
      }

      actions.push({ type: "endTurn" });
      return actions;
    }
    case "finished":
      return [];
  }
}

function validateActionPayload(
  state: EngineState,
  playerId: string,
  action: GameAction,
  descriptor: LegalAction,
): void {
  switch (action.type) {
    case "placeInitialSettlement":
    case "buildSettlement":
    case "upgradeCity": {
      if (
        !("vertexIds" in descriptor) ||
        !descriptor.vertexIds.includes(action.vertexId)
      ) {
        throw new RulesError("illegal_action", "The vertex is not legal");
      }
      return;
    }
    case "placeInitialRoad":
    case "buildRoad": {
      if (
        !("edgeIds" in descriptor) ||
        !descriptor.edgeIds.includes(action.edgeId)
      ) {
        throw new RulesError("illegal_action", "The edge is not legal");
      }
      return;
    }
    case "discardResources": {
      const requiredCount =
        "requiredCount" in descriptor ? descriptor.requiredCount : -1;
      const player = requirePlayer(state, playerId);
      if (
        sumResources(action.resources) !== requiredCount ||
        !hasResources(player.resources, action.resources)
      ) {
        throw new RulesError(
          "illegal_action",
          `Exactly ${requiredCount} owned resources must be discarded`,
        );
      }
      return;
    }
    case "moveRobber": {
      if (
        !("hexIds" in descriptor) ||
        !descriptor.hexIds.includes(action.hexId)
      ) {
        throw new RulesError(
          "illegal_action",
          "The robber must move to a new hex",
        );
      }
      const victims = victimIdsForHex(state, action.hexId, playerId);
      const validVictim =
        victims.length === 0
          ? action.victimPlayerId === null
          : action.victimPlayerId !== null &&
            victims.includes(action.victimPlayerId);
      if (!validVictim) {
        throw new RulesError(
          "illegal_action",
          "The selected victim is not eligible on that hex",
        );
      }
      return;
    }
    case "playMonopoly":
      return;
    case "playYearOfPlenty": {
      const requested = emptyResourceMap();
      requested[action.resources[0]] += 1;
      requested[action.resources[1]] += 1;
      if (!hasResources(state.bank, requested)) {
        throw new RulesError(
          "illegal_action",
          "The bank cannot supply both selected resources",
        );
      }
      return;
    }
    case "playRoadBuilding": {
      const player = requirePlayer(state, playerId);
      if (
        action.edgeIds.length > player.roadsRemaining ||
        new Set(action.edgeIds).size !== action.edgeIds.length
      ) {
        throw new RulesError(
          "illegal_action",
          "The road placements are invalid",
        );
      }
      const simulated = structuredClone(state);
      for (const edgeId of action.edgeIds) {
        if (!getLegalRoadEdges(simulated, playerId).includes(edgeId)) {
          throw new RulesError(
            "illegal_action",
            "Road Building edges must be legal in placement order",
          );
        }
        simulated.board.edges.find((edge) => edge.id === edgeId)!.roadPlayerId =
          playerId;
      }
      return;
    }
    case "maritimeTrade": {
      const give = nonzeroResources(action.give);
      const receive = nonzeroResources(action.receive);
      const player = requirePlayer(state, playerId);
      const rates = getMaritimeRates(state.board, playerId);
      if (
        give.length !== 1 ||
        receive.length !== 1 ||
        give[0]![1] !== rates[give[0]![0]] ||
        receive[0]![1] !== 1 ||
        give[0]![0] === receive[0]![0] ||
        !hasResources(player.resources, action.give) ||
        !hasResources(state.bank, action.receive)
      ) {
        throw new RulesError("illegal_action", "The maritime trade is invalid");
      }
      return;
    }
    case "rollDice":
    case "buyDevelopmentCard":
    case "playKnight":
    case "endTurn":
      return;
  }
}

function placeBuilding(
  state: EngineState,
  playerId: string,
  vertexId: string,
  type: "settlement" | "city",
): void {
  const vertex = state.board.vertices.find(
    (candidate) => candidate.id === vertexId,
  );
  if (!vertex) {
    throw new RulesError("invalid_state", `Unknown vertex: ${vertexId}`);
  }
  vertex.building = { playerId, type };
}

function placeRoad(state: EngineState, playerId: string, edgeId: string): void {
  const edge = state.board.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) {
    throw new RulesError("invalid_state", `Unknown edge: ${edgeId}`);
  }
  edge.roadPlayerId = playerId;
}

function grantSecondSettlementResources(
  state: EngineState,
  player: EnginePlayer,
  vertexId: string,
): ResourceMap {
  const granted = emptyResourceMap();
  const vertex = state.board.vertices.find(
    (candidate) => candidate.id === vertexId,
  )!;
  for (const hexId of vertex.adjacentHexIds) {
    const hex = state.board.hexes.find((candidate) => candidate.id === hexId)!;
    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (resource && state.bank[resource] > 0) {
      state.bank[resource] -= 1;
      player.resources[resource] += 1;
      granted[resource] += 1;
    }
  }
  return granted;
}

function advanceInitialPlacement(state: EngineState): void {
  state.turn.initialPlacementIndex += 1;
  state.turn.initialSettlementVertexId = null;
  if (state.turn.initialPlacementIndex >= state.setupOrder.length) {
    state.status = "active";
    state.turnNumber = 1;
    state.turn.activePlayerId = state.playerOrder[0]!;
    state.turn.phase = "roll";
    state.turn.requiredActorPlayerIds = [state.playerOrder[0]!];
    state.turn.developmentCardPlayed = false;
    return;
  }

  const nextPlayerId = state.setupOrder[state.turn.initialPlacementIndex]!;
  state.turn.activePlayerId = nextPlayerId;
  state.turn.phase = "place_initial_settlement";
  state.turn.requiredActorPlayerIds = [nextPlayerId];
}

function rollDice(state: EngineState): [number, number] {
  const first = randomInteger(state.rngState, 6);
  const second = randomInteger(first.state, 6);
  state.rngState = second.state;
  return [first.value + 1, second.value + 1];
}

function distributeProduction(state: EngineState, total: number): ResourceMap {
  const demandByPlayer = new Map<string, ResourceMap>(
    state.players.map((player) => [player.id, emptyResourceMap()]),
  );
  const totalDemand = emptyResourceMap();

  for (const hex of state.board.hexes) {
    const resource = TERRAIN_RESOURCE[hex.terrain];
    if (!resource || hex.hasRobber || hex.number !== total) {
      continue;
    }

    for (const vertex of state.board.vertices) {
      if (!vertex.adjacentHexIds.includes(hex.id) || vertex.building === null) {
        continue;
      }
      const amount = vertex.building.type === "city" ? 2 : 1;
      demandByPlayer.get(vertex.building.playerId)![resource] += amount;
      totalDemand[resource] += amount;
    }
  }

  const produced = emptyResourceMap();
  for (const resource of RESOURCES) {
    if (totalDemand[resource] > state.bank[resource]) {
      continue;
    }
    for (const player of state.players) {
      const amount = demandByPlayer.get(player.id)![resource];
      player.resources[resource] += amount;
      state.bank[resource] -= amount;
      produced[resource] += amount;
    }
  }
  return produced;
}

function stealResource(
  state: EngineState,
  player: EnginePlayer,
  victim: EnginePlayer,
): Resource | null {
  const available = RESOURCES.flatMap((resource) =>
    Array<Resource>(victim.resources[resource]).fill(resource),
  );
  if (available.length === 0) {
    return null;
  }

  const random = randomInteger(state.rngState, available.length);
  state.rngState = random.state;
  const resource = available[random.value]!;
  victim.resources[resource] -= 1;
  player.resources[resource] += 1;
  return resource;
}

function useDevelopmentCard(
  state: EngineState,
  player: EnginePlayer,
  type: DevelopmentCardType,
): EngineDevelopmentCard {
  const card = playableDevelopmentCard(state, player, type);
  if (!card) {
    throw new RulesError("illegal_action", `No playable ${type} card`);
  }
  card.played = true;
  state.turn.developmentCardPlayed = true;
  return card;
}

function beginNextTurn(state: EngineState): void {
  const currentIndex = state.playerOrder.indexOf(state.turn.activePlayerId);
  const nextIndex = (currentIndex + 1) % state.playerOrder.length;
  state.turnNumber += 1;
  state.turn.activePlayerId = state.playerOrder[nextIndex]!;
  state.turn.phase = "roll";
  state.turn.requiredActorPlayerIds = [state.turn.activePlayerId];
  state.turn.developmentCardPlayed = false;
  state.turn.discardRequirements = {};
  state.dice = null;
}

function finishIfWon(
  state: EngineState,
  actingPlayerId: string,
  events: EngineEvent[],
): void {
  if (
    state.status !== "active" ||
    getVictoryPoints(state, actingPlayerId) < state.victoryPointsToWin
  ) {
    return;
  }
  state.status = "finished";
  state.winnerPlayerId = actingPlayerId;
  state.turn.activePlayerId = actingPlayerId;
  state.turn.phase = "finished";
  state.turn.requiredActorPlayerIds = [];
  events.push(
    publicEvent("gameFinished", actingPlayerId, {
      winnerPlayerId: actingPlayerId,
      victoryPoints: getVictoryPoints(state, actingPlayerId),
    }),
  );
}

export function applyAction(
  sourceState: EngineState,
  playerId: string,
  action: GameAction,
): EngineResult {
  const state = structuredClone(sourceState);
  requirePlayer(state, playerId);
  requireTurnActor(state, playerId);
  const descriptor = getLegalActions(state, playerId).find(
    (candidate) => candidate.type === action.type,
  );
  if (!descriptor) {
    throw new RulesError(
      "illegal_action",
      `${action.type} is not legal in phase ${state.turn.phase}`,
    );
  }
  validateActionPayload(state, playerId, action, descriptor);

  const player = requirePlayer(state, playerId);
  const events: EngineEvent[] = [];

  switch (action.type) {
    case "placeInitialSettlement": {
      placeBuilding(state, playerId, action.vertexId, "settlement");
      player.settlementsRemaining -= 1;
      state.turn.phase = "place_initial_road";
      state.turn.initialSettlementVertexId = action.vertexId;
      const secondPlacement =
        state.turn.initialPlacementIndex >= state.playerOrder.length;
      events.push(
        publicEvent("initialSettlementPlaced", playerId, {
          playerId,
          vertexId: action.vertexId,
        }),
      );
      if (secondPlacement) {
        const resources = grantSecondSettlementResources(
          state,
          player,
          action.vertexId,
        );
        events.push(
          privateEvent("initialResourcesReceived", playerId, { resources }),
        );
      }
      break;
    }
    case "placeInitialRoad":
      placeRoad(state, playerId, action.edgeId);
      player.roadsRemaining -= 1;
      events.push(
        publicEvent("initialRoadPlaced", playerId, {
          playerId,
          edgeId: action.edgeId,
        }),
      );
      advanceInitialPlacement(state);
      break;
    case "rollDice": {
      const values = rollDice(state);
      const total = values[0] + values[1];
      state.dice = { values, total };
      events.push(
        publicEvent("diceRolled", playerId, { playerId, values, total }),
      );

      if (total === 7) {
        const requirements = Object.fromEntries(
          state.players.flatMap((candidate) => {
            const count = sumResources(candidate.resources);
            return count > 7 ? [[candidate.id, Math.floor(count / 2)]] : [];
          }),
        );
        state.turn.discardRequirements = requirements;
        state.turn.requiredActorPlayerIds = state.players
          .filter((candidate) => requirements[candidate.id] !== undefined)
          .sort((left, right) => left.seat - right.seat)
          .map((candidate) => candidate.id);
        state.turn.phase =
          state.turn.requiredActorPlayerIds.length > 0
            ? "discard"
            : "move_robber";
        if (state.turn.phase === "move_robber") {
          state.turn.requiredActorPlayerIds = [playerId];
        }
      } else {
        const resources = distributeProduction(state, total);
        state.turn.phase = "main";
        state.turn.requiredActorPlayerIds = [playerId];
        events.push(
          publicEvent("resourcesProduced", null, { roll: total, resources }),
        );
      }
      break;
    }
    case "discardResources":
      subtractResources(player.resources, action.resources);
      addResources(state.bank, action.resources);
      delete state.turn.discardRequirements[playerId];
      state.turn.requiredActorPlayerIds =
        state.turn.requiredActorPlayerIds.filter(
          (candidate) => candidate !== playerId,
        );
      events.push(
        publicEvent("resourcesDiscarded", playerId, {
          playerId,
          count: sumResources(action.resources),
        }),
      );
      if (state.turn.requiredActorPlayerIds.length === 0) {
        state.turn.phase = "move_robber";
        state.turn.requiredActorPlayerIds = [state.turn.activePlayerId];
      }
      break;
    case "moveRobber": {
      for (const hex of state.board.hexes) {
        hex.hasRobber = hex.id === action.hexId;
      }
      let stolenResource: Resource | null = null;
      if (action.victimPlayerId !== null) {
        stolenResource = stealResource(
          state,
          player,
          requirePlayer(state, action.victimPlayerId),
        );
      }
      state.turn.phase = "main";
      state.turn.requiredActorPlayerIds = [state.turn.activePlayerId];
      events.push(
        publicEvent("robberMoved", playerId, {
          playerId,
          hexId: action.hexId,
          victimPlayerId: action.victimPlayerId,
        }),
      );
      if (stolenResource !== null) {
        events.push(
          privateEvent("resourceStolen", playerId, {
            fromPlayerId: action.victimPlayerId,
            resource: stolenResource,
          }),
        );
      }
      break;
    }
    case "buildRoad":
      transferToBank(state, player, ROAD_COST);
      placeRoad(state, playerId, action.edgeId);
      player.roadsRemaining -= 1;
      events.push(
        publicEvent("roadBuilt", playerId, {
          playerId,
          edgeId: action.edgeId,
        }),
      );
      break;
    case "buildSettlement":
      transferToBank(state, player, SETTLEMENT_COST);
      placeBuilding(state, playerId, action.vertexId, "settlement");
      player.settlementsRemaining -= 1;
      events.push(
        publicEvent("settlementBuilt", playerId, {
          playerId,
          vertexId: action.vertexId,
        }),
      );
      break;
    case "upgradeCity":
      transferToBank(state, player, CITY_COST);
      placeBuilding(state, playerId, action.vertexId, "city");
      player.citiesRemaining -= 1;
      player.settlementsRemaining += 1;
      events.push(
        publicEvent("cityBuilt", playerId, {
          playerId,
          vertexId: action.vertexId,
        }),
      );
      break;
    case "buyDevelopmentCard": {
      transferToBank(state, player, DEVELOPMENT_CARD_COST);
      const type = state.developmentDeck.pop();
      if (!type) {
        throw new RulesError("invalid_state", "Development deck is empty");
      }
      const card: EngineDevelopmentCard = {
        id: `dev_${state.nextDevelopmentCardId}`,
        type,
        purchasedTurn: state.turnNumber,
        played: false,
      };
      state.nextDevelopmentCardId += 1;
      player.developmentCards.push(card);
      events.push(
        publicEvent("developmentCardBought", playerId, { playerId }),
        privateEvent("developmentCardReceived", playerId, {
          cardId: card.id,
          type: card.type,
        }),
      );
      break;
    }
    case "playKnight":
      useDevelopmentCard(state, player, "knight");
      player.playedKnights += 1;
      state.turn.phase = "move_robber";
      state.turn.requiredActorPlayerIds = [playerId];
      events.push(publicEvent("knightPlayed", playerId, { playerId }));
      break;
    case "playMonopoly": {
      useDevelopmentCard(state, player, "monopoly");
      let amount = 0;
      for (const opponent of state.players) {
        if (opponent.id === playerId) {
          continue;
        }
        const transferred = opponent.resources[action.resource];
        opponent.resources[action.resource] = 0;
        player.resources[action.resource] += transferred;
        amount += transferred;
      }
      events.push(
        publicEvent("monopolyPlayed", playerId, {
          playerId,
          resource: action.resource,
          amount,
        }),
      );
      break;
    }
    case "playYearOfPlenty": {
      useDevelopmentCard(state, player, "year_of_plenty");
      const resources = emptyResourceMap();
      resources[action.resources[0]] += 1;
      resources[action.resources[1]] += 1;
      transferFromBank(state, player, resources);
      events.push(
        publicEvent("yearOfPlentyPlayed", playerId, { playerId }),
        privateEvent("yearOfPlentyResourcesReceived", playerId, { resources }),
      );
      break;
    }
    case "playRoadBuilding":
      useDevelopmentCard(state, player, "road_building");
      for (const edgeId of action.edgeIds) {
        placeRoad(state, playerId, edgeId);
        player.roadsRemaining -= 1;
      }
      events.push(
        publicEvent("roadBuildingPlayed", playerId, {
          playerId,
          edgeIds: action.edgeIds,
        }),
      );
      break;
    case "maritimeTrade":
      subtractResources(player.resources, action.give);
      addResources(state.bank, action.give);
      subtractResources(state.bank, action.receive);
      addResources(player.resources, action.receive);
      events.push(
        publicEvent("maritimeTradeExecuted", playerId, {
          playerId,
          give: action.give,
          receive: action.receive,
        }),
      );
      break;
    case "endTurn":
      events.push(publicEvent("turnEnded", playerId, { playerId }));
      beginNextTurn(state);
      break;
  }

  recalculateAwards(state);
  finishIfWon(state, playerId, events);
  state.version += 1;
  return { state, events };
}

function validateDirectTradeResources(
  offering: ResourceMap,
  requesting: ResourceMap,
): void {
  if (sumResources(offering) === 0 || sumResources(requesting) === 0) {
    throw new RulesError(
      "illegal_action",
      "Both sides of a trade must be nonempty",
    );
  }
  if (
    RESOURCES.some(
      (resource) => offering[resource] > 0 && requesting[resource] > 0,
    )
  ) {
    throw new RulesError(
      "illegal_action",
      "A resource cannot appear on both sides of a trade",
    );
  }
}

export function applyPlayerTrade(
  sourceState: EngineState,
  fromPlayerId: string,
  toPlayerId: string,
  offering: ResourceMap,
  requesting: ResourceMap,
): EngineResult {
  const state = structuredClone(sourceState);
  if (
    state.status !== "active" ||
    state.turn.phase !== "main" ||
    state.turn.activePlayerId !== fromPlayerId ||
    fromPlayerId === toPlayerId
  ) {
    throw new RulesError(
      "illegal_action",
      "Player trades require the active player during the main phase",
    );
  }
  validateDirectTradeResources(offering, requesting);
  const fromPlayer = requirePlayer(state, fromPlayerId);
  const toPlayer = requirePlayer(state, toPlayerId);
  if (
    !hasResources(fromPlayer.resources, offering) ||
    !hasResources(toPlayer.resources, requesting)
  ) {
    throw new RulesError(
      "illegal_action",
      "A player no longer owns the proposed resources",
    );
  }

  subtractResources(fromPlayer.resources, offering);
  addResources(toPlayer.resources, offering);
  subtractResources(toPlayer.resources, requesting);
  addResources(fromPlayer.resources, requesting);
  state.version += 1;
  return {
    state,
    events: [
      publicEvent("tradeExecuted", toPlayerId, {
        fromPlayerId,
        toPlayerId,
        offering,
        requesting,
      }),
    ],
  };
}

function fallbackDiscard(
  state: EngineState,
  playerId: string,
  requiredCount: number,
): ResourceMap {
  const player = requirePlayer(state, playerId);
  const discarded = emptyResourceMap();
  let remaining = requiredCount;
  const orderedResources = [...RESOURCES].sort(
    (left, right) =>
      player.resources[right] - player.resources[left] ||
      left.localeCompare(right),
  );
  for (const resource of orderedResources) {
    const count = Math.min(player.resources[resource], remaining);
    discarded[resource] = count;
    remaining -= count;
  }
  return discarded;
}

export function chooseFallbackAction(
  state: EngineState,
  playerId: string,
): GameAction | null {
  const legalActions = getLegalActions(state, playerId);
  if (legalActions.length === 0) {
    return null;
  }
  const action = legalActions[0]!;
  switch (action.type) {
    case "placeInitialSettlement":
      return {
        type: "placeInitialSettlement",
        vertexId: action.vertexIds[0]!,
      };
    case "placeInitialRoad":
      return { type: "placeInitialRoad", edgeId: action.edgeIds[0]! };
    case "rollDice":
      return { type: "rollDice" };
    case "discardResources":
      return {
        type: "discardResources",
        resources: fallbackDiscard(state, playerId, action.requiredCount),
      };
    case "moveRobber": {
      const hexId = action.hexIds[0]!;
      const victims = victimIdsForHex(state, hexId, playerId);
      return {
        type: "moveRobber",
        hexId,
        victimPlayerId: victims[0] ?? null,
      };
    }
    case "endTurn":
      return { type: "endTurn" };
    default: {
      const endTurn = legalActions.find(
        (candidate) => candidate.type === "endTurn",
      );
      return endTurn ? { type: "endTurn" } : null;
    }
  }
}
