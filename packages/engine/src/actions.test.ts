import type {
  DevelopmentCardType,
  Resource,
  ResourceMap,
} from "@catanbench/protocol";
import { describe, expect, it } from "vitest";

import { applyAction, createGame, getLegalActions } from "./engine";
import { edgesAtVertex, getVictoryPoints } from "./graph";
import { emptyResourceMap, singleResourceMap } from "./resources";
import type {
  EngineDevelopmentCard,
  EnginePlayerInput,
  EngineState,
} from "./types";

const PLAYERS: EnginePlayerInput[] = [
  { id: "player_a", seat: 0, name: "A", color: "red" },
  { id: "player_b", seat: 1, name: "B", color: "blue" },
  { id: "player_c", seat: 2, name: "C", color: "white" },
];

function mainState(seed = "action-test"): EngineState {
  const state = createGame({ gameId: "game_actions", seed, players: PLAYERS });
  state.status = "active";
  state.turnNumber = 2;
  state.turn.activePlayerId = "player_a";
  state.turn.phase = "main";
  state.turn.requiredActorPlayerIds = ["player_a"];
  state.turn.initialSettlementVertexId = null;
  state.turn.developmentCardPlayed = false;
  state.board.vertices[0]!.building = {
    playerId: "player_a",
    type: "settlement",
  };
  state.players[0]!.settlementsRemaining = 4;
  const road = edgesAtVertex(state.board, state.board.vertices[0]!.id)[0]!;
  road.roadPlayerId = "player_a";
  state.players[0]!.roadsRemaining = 14;
  return state;
}

function fund(
  state: EngineState,
  playerId: string,
  resources: ResourceMap,
): void {
  const player = state.players.find((candidate) => candidate.id === playerId)!;
  for (const resource of Object.keys(resources) as Resource[]) {
    player.resources[resource] += resources[resource];
    state.bank[resource] -= resources[resource];
  }
}

function addPlayableCard(
  state: EngineState,
  type: DevelopmentCardType,
): EngineDevelopmentCard {
  const card = {
    id: `dev_test_${type}`,
    type,
    purchasedTurn: state.turnNumber - 1,
    played: false,
  };
  state.players[0]!.developmentCards.push(card);
  return card;
}

describe("building and scoring", () => {
  it("upgrades a settlement to a city and returns the settlement piece", () => {
    const state = mainState("city");
    fund(state, "player_a", {
      brick: 0,
      lumber: 0,
      ore: 3,
      grain: 2,
      wool: 0,
    });
    const vertexId = state.board.vertices[0]!.id;

    const result = applyAction(state, "player_a", {
      type: "upgradeCity",
      vertexId,
    });

    expect(result.state.board.vertices[0]!.building?.type).toBe("city");
    expect(result.state.players[0]!.citiesRemaining).toBe(3);
    expect(result.state.players[0]!.settlementsRemaining).toBe(5);
    expect(getVictoryPoints(result.state, "player_a")).toBe(2);
  });

  it("ends the game when a build reaches the configured score", () => {
    const state = mainState("winner");
    state.victoryPointsToWin = 3;
    state.players[0]!.developmentCards.push({
      id: "dev_vp",
      type: "victory_point",
      purchasedTurn: 1,
      played: false,
    });
    fund(state, "player_a", {
      brick: 0,
      lumber: 0,
      ore: 3,
      grain: 2,
      wool: 0,
    });

    const result = applyAction(state, "player_a", {
      type: "upgradeCity",
      vertexId: state.board.vertices[0]!.id,
    });

    expect(result.state.status).toBe("finished");
    expect(result.state.winnerPlayerId).toBe("player_a");
    expect(result.state.turn.phase).toBe("finished");
    expect(result.events.at(-1)?.type).toBe("gameFinished");
  });
});

describe("development cards", () => {
  it("plays Monopoly and moves every matching resource", () => {
    const state = mainState("monopoly");
    addPlayableCard(state, "monopoly");
    state.players[1]!.resources.brick = 2;
    state.players[2]!.resources.brick = 3;

    const result = applyAction(state, "player_a", {
      type: "playMonopoly",
      resource: "brick",
    });

    expect(result.state.players[0]!.resources.brick).toBe(5);
    expect(result.state.players[1]!.resources.brick).toBe(0);
    expect(result.state.players[2]!.resources.brick).toBe(0);
    expect(result.state.turn.developmentCardPlayed).toBe(true);
  });

  it("draws exactly two available Year of Plenty resources", () => {
    const state = mainState("plenty");
    addPlayableCard(state, "year_of_plenty");

    const result = applyAction(state, "player_a", {
      type: "playYearOfPlenty",
      resources: ["ore", "ore"],
    });

    expect(result.state.players[0]!.resources.ore).toBe(2);
    expect(result.state.bank.ore).toBe(17);
  });

  it("places sequential free roads with Road Building", () => {
    const state = mainState("road-building");
    addPlayableCard(state, "road_building");
    const descriptor = getLegalActions(state, "player_a").find(
      (action) => action.type === "playRoadBuilding",
    );
    expect(descriptor?.type).toBe("playRoadBuilding");
    const firstEdgeId =
      descriptor?.type === "playRoadBuilding"
        ? descriptor.firstEdgeIds[0]!
        : "missing";
    const simulated = structuredClone(state);
    simulated.board.edges.find(
      (edge) => edge.id === firstEdgeId,
    )!.roadPlayerId = "player_a";
    const secondDescriptor = getLegalActions(simulated, "player_a").find(
      (action) => action.type === "playRoadBuilding",
    );
    const secondEdgeId =
      secondDescriptor?.type === "playRoadBuilding"
        ? secondDescriptor.firstEdgeIds.find(
            (edgeId) => edgeId !== firstEdgeId,
          )!
        : "missing";

    const result = applyAction(state, "player_a", {
      type: "playRoadBuilding",
      edgeIds: [firstEdgeId, secondEdgeId],
    });

    expect(
      result.state.board.edges.filter(
        (edge) =>
          [firstEdgeId, secondEdgeId].includes(edge.id) &&
          edge.roadPlayerId === "player_a",
      ),
    ).toHaveLength(2);
    expect(result.state.players[0]!.roadsRemaining).toBe(12);
  });

  it("moves to the robber phase and counts a played Knight", () => {
    const state = mainState("knight");
    addPlayableCard(state, "knight");
    state.players[0]!.playedKnights = 2;

    const result = applyAction(state, "player_a", { type: "playKnight" });

    expect(result.state.turn.phase).toBe("move_robber");
    expect(result.state.players[0]!.playedKnights).toBe(3);
    expect(result.state.awards.largestArmy.playerId).toBe("player_a");
  });
});

describe("maritime trading", () => {
  it("uses a resource-specific port at two-to-one", () => {
    const state = mainState("port");
    const port = state.board.ports.find(
      (candidate) => candidate.resource !== null,
    )!;
    const giveResource = port.resource!;
    const receiveResource = (
      ["brick", "lumber", "ore", "grain", "wool"] as Resource[]
    ).find((resource) => resource !== giveResource)!;
    state.board.vertices[0]!.building = null;
    state.board.vertices.find(
      (vertex) => vertex.id === port.vertexIds[0],
    )!.building = { playerId: "player_a", type: "settlement" };
    fund(state, "player_a", singleResourceMap(giveResource, 2));
    const give = singleResourceMap(giveResource, 2);
    const receive = singleResourceMap(receiveResource, 1);

    const descriptor = getLegalActions(state, "player_a").find(
      (action) => action.type === "maritimeTrade",
    );
    expect(descriptor?.type).toBe("maritimeTrade");
    if (descriptor?.type === "maritimeTrade") {
      expect(descriptor.giveRates[giveResource]).toBe(2);
    }

    const result = applyAction(state, "player_a", {
      type: "maritimeTrade",
      give,
      receive,
    });
    expect(result.state.players[0]!.resources[giveResource]).toBe(0);
    expect(result.state.players[0]!.resources[receiveResource]).toBe(1);
  });

  it("does not advertise a trade when the bank only has the given resource", () => {
    const state = mainState("no-bank-trade");
    const resources = emptyResourceMap();
    resources.brick = 4;
    state.players[0]!.resources = resources;
    state.bank = { brick: 15, lumber: 0, ore: 0, grain: 0, wool: 0 };

    expect(
      getLegalActions(state, "player_a").some(
        (action) => action.type === "maritimeTrade",
      ),
    ).toBe(false);
  });
});
