import type { Resource, ResourceMap } from "@catanbench/protocol";
import { describe, expect, it } from "vitest";

import { TERRAIN_RESOURCE } from "./constants";
import {
  applyAction,
  applyPlayerTrade,
  chooseFallbackAction,
  createGame,
  getLegalActions,
} from "./engine";
import { getLongestRoadLength, recalculateAwards } from "./graph";
import { randomInteger } from "./random";
import { emptyResourceMap, singleResourceMap } from "./resources";
import type { EnginePlayerInput, EngineState, GameAction } from "./types";
import { RulesError } from "./types";

const PLAYERS: EnginePlayerInput[] = [
  { id: "player_a", seat: 0, name: "A", color: "red" },
  { id: "player_b", seat: 1, name: "B", color: "blue" },
  { id: "player_c", seat: 2, name: "C", color: "white" },
];

function newGame(seed = "engine-test"): EngineState {
  return createGame({ gameId: "game_test", seed, players: PLAYERS });
}

function applyFallback(state: EngineState, playerId?: string): EngineState {
  const actor = playerId ?? state.turn.requiredActorPlayerIds[0]!;
  const action = chooseFallbackAction(state, actor);
  if (!action) {
    throw new Error(`No fallback for ${state.turn.phase}`);
  }
  return applyAction(state, actor, action).state;
}

function completeSetup(state = newGame()): EngineState {
  let current = state;
  while (current.status === "initial_placement") {
    current = applyFallback(current);
  }
  return current;
}

function findRngStateForTotal(total: number): number {
  for (let state = 1; state < 100_000; state += 1) {
    const first = randomInteger(state, 6);
    const second = randomInteger(first.state, 6);
    if (first.value + second.value + 2 === total) {
      return state;
    }
  }
  throw new Error(`Unable to find RNG state for ${total}`);
}

function advanceToMain(state = completeSetup()): EngineState {
  const ready =
    state.status === "initial_placement" ? completeSetup(state) : state;
  let current = applyAction(
    { ...ready, rngState: findRngStateForTotal(6) },
    ready.turn.activePlayerId,
    { type: "rollDice" },
  ).state;
  if (current.turn.phase === "move_robber") {
    current = applyFallback(current);
  }
  return current;
}

function fundPlayer(
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

function findEdgePath(state: EngineState, length: number): string[] {
  const incident = new Map<string, typeof state.board.edges>();
  for (const edge of state.board.edges) {
    for (const vertexId of edge.vertexIds) {
      const edges = incident.get(vertexId) ?? [];
      edges.push(edge);
      incident.set(vertexId, edges);
    }
  }

  function visit(
    vertexId: string,
    edgeIds: string[],
    visitedVertices: Set<string>,
  ): string[] | null {
    if (edgeIds.length === length) {
      return edgeIds;
    }
    for (const edge of incident.get(vertexId) ?? []) {
      if (edgeIds.includes(edge.id)) {
        continue;
      }
      const nextVertexId =
        edge.vertexIds[0] === vertexId ? edge.vertexIds[1] : edge.vertexIds[0];
      if (visitedVertices.has(nextVertexId)) {
        continue;
      }
      const nextVisited = new Set(visitedVertices);
      nextVisited.add(nextVertexId);
      const result = visit(nextVertexId, [...edgeIds, edge.id], nextVisited);
      if (result) {
        return result;
      }
    }
    return null;
  }

  for (const vertex of state.board.vertices) {
    const path = visit(vertex.id, [], new Set([vertex.id]));
    if (path) {
      return path;
    }
  }
  throw new Error(`No path with ${length} edges`);
}

describe("game creation and initial placement", () => {
  it("creates a deterministic snake-order setup", () => {
    const first = newGame("same-seed");
    const second = newGame("same-seed");

    expect(first).toEqual(second);
    expect(first.setupOrder).toEqual([
      "player_a",
      "player_b",
      "player_c",
      "player_c",
      "player_b",
      "player_a",
    ]);
    expect(first.board.hexes).toHaveLength(19);
    expect(first.developmentDeck).toHaveLength(25);
  });

  it("completes two settlement-road rounds and begins the first turn", () => {
    const state = completeSetup();

    expect(state.status).toBe("active");
    expect(state.turnNumber).toBe(1);
    expect(state.turn.phase).toBe("roll");
    expect(state.turn.activePlayerId).toBe("player_a");
    expect(state.version).toBe(12);
    for (const player of state.players) {
      expect(player.settlementsRemaining).toBe(3);
      expect(player.roadsRemaining).toBe(13);
    }
  });

  it("does not mutate the source state", () => {
    const source = newGame();
    const action = chooseFallbackAction(source, "player_a")!;
    const result = applyAction(source, "player_a", action);

    expect(source.version).toBe(0);
    expect(
      source.board.vertices.every((vertex) => vertex.building === null),
    ).toBe(true);
    expect(result.state.version).toBe(1);
    expect(
      result.state.board.vertices.some((vertex) => vertex.building !== null),
    ).toBe(true);
  });
});

describe("turn rules", () => {
  it("rolls deterministically and distributes production", () => {
    const state = newGame("production");
    const targetHex = state.board.hexes.find(
      (hex) => hex.number !== null && hex.number !== 7,
    )!;
    const targetResource = TERRAIN_RESOURCE[targetHex.terrain]!;
    const vertex = state.board.vertices.find((candidate) =>
      candidate.adjacentHexIds.includes(targetHex.id),
    )!;
    vertex.building = { playerId: "player_a", type: "settlement" };
    state.players[0]!.settlementsRemaining -= 1;
    state.status = "active";
    state.turnNumber = 1;
    state.turn.activePlayerId = "player_a";
    state.turn.phase = "roll";
    state.turn.requiredActorPlayerIds = ["player_a"];
    state.rngState = findRngStateForTotal(targetHex.number!);

    const result = applyAction(state, "player_a", { type: "rollDice" });

    expect(result.state.dice?.total).toBe(targetHex.number);
    expect(result.state.turn.phase).toBe("main");
    expect(result.state.players[0]!.resources[targetResource]).toBeGreaterThan(
      0,
    );
    expect(result.events.map((event) => event.type)).toContain(
      "resourcesProduced",
    );
  });

  it("requires every player over seven cards to discard half", () => {
    const state = completeSetup(newGame("discard"));
    state.players[0]!.resources = {
      brick: 10,
      lumber: 0,
      ore: 0,
      grain: 0,
      wool: 0,
    };
    state.rngState = findRngStateForTotal(7);

    const rolled = applyAction(state, "player_a", { type: "rollDice" }).state;
    expect(rolled.turn.phase).toBe("discard");
    expect(rolled.turn.requiredActorPlayerIds).toContain("player_a");
    expect(getLegalActions(rolled, "player_a")).toEqual([
      { type: "discardResources", requiredCount: 5 },
    ]);

    const discarded = applyFallback(rolled, "player_a");
    expect(discarded.players[0]!.resources.brick).toBe(5);
    expect(discarded.turn.phase).toBe("move_robber");
    expect(applyFallback(discarded).turn.phase).toBe("main");
  });

  it("builds only connected roads and pays the bank", () => {
    const state = advanceToMain();
    const playerId = state.turn.activePlayerId;
    fundPlayer(state, playerId, {
      brick: 1,
      lumber: 1,
      ore: 0,
      grain: 0,
      wool: 0,
    });
    const actionDescriptor = getLegalActions(state, playerId).find(
      (action) => action.type === "buildRoad",
    );
    expect(actionDescriptor?.type).toBe("buildRoad");
    const edgeId =
      actionDescriptor?.type === "buildRoad"
        ? actionDescriptor.edgeIds[0]!
        : "missing";

    const result = applyAction(state, playerId, { type: "buildRoad", edgeId });
    expect(
      result.state.board.edges.find((edge) => edge.id === edgeId)?.roadPlayerId,
    ).toBe(playerId);
    expect(result.state.players[0]!.resources.brick).toBe(
      state.players[0]!.resources.brick - 1,
    );
    expect(() =>
      applyAction(state, playerId, { type: "buildRoad", edgeId: "edge_bad" }),
    ).toThrowError(RulesError);
  });

  it("keeps a newly purchased development card unplayable this turn", () => {
    const state = advanceToMain(newGame("development-card"));
    const playerId = state.turn.activePlayerId;
    state.developmentDeck = ["knight"];
    fundPlayer(state, playerId, {
      brick: 0,
      lumber: 0,
      ore: 1,
      grain: 1,
      wool: 1,
    });

    const bought = applyAction(state, playerId, {
      type: "buyDevelopmentCard",
    }).state;
    expect(bought.players[0]!.developmentCards[0]?.type).toBe("knight");
    expect(
      getLegalActions(bought, playerId).some((a) => a.type === "playKnight"),
    ).toBe(false);

    bought.turnNumber += 1;
    expect(
      getLegalActions(bought, playerId).some((a) => a.type === "playKnight"),
    ).toBe(true);
  });
});

describe("awards, trades, and fallbacks", () => {
  it("awards and blocks the longest road", () => {
    const state = newGame("longest-road");
    const path = findEdgePath(state, 5);
    for (const edgeId of path) {
      state.board.edges.find((edge) => edge.id === edgeId)!.roadPlayerId =
        "player_a";
    }

    expect(getLongestRoadLength(state.board, "player_a")).toBe(5);
    recalculateAwards(state);
    expect(state.awards.longestRoad).toEqual({
      playerId: "player_a",
      length: 5,
    });

    const middleEdge = state.board.edges.find((edge) => edge.id === path[2])!;
    const blockingVertex = middleEdge.vertexIds[1];
    state.board.vertices.find(
      (vertex) => vertex.id === blockingVertex,
    )!.building = {
      playerId: "player_b",
      type: "settlement",
    };
    expect(getLongestRoadLength(state.board, "player_a")).toBeLessThan(5);
  });

  it("executes player trades atomically during the main phase", () => {
    const state = advanceToMain(newGame("trade"));
    const from = state.turn.activePlayerId;
    const to = state.playerOrder.find((playerId) => playerId !== from)!;
    const offering = singleResourceMap("grain", 1);
    const requesting = singleResourceMap("ore", 1);
    fundPlayer(state, from, offering);
    fundPlayer(state, to, requesting);
    const fromOreBefore = state.players.find((player) => player.id === from)!
      .resources.ore;
    const toGrainBefore = state.players.find((player) => player.id === to)!
      .resources.grain;

    const result = applyPlayerTrade(state, from, to, offering, requesting);
    expect(result.state.version).toBe(state.version + 1);
    expect(
      result.state.players.find((player) => player.id === from)?.resources.ore,
    ).toBe(fromOreBefore + 1);
    expect(
      result.state.players.find((player) => player.id === to)?.resources.grain,
    ).toBe(toGrainBefore + 1);
    expect(
      state.players.find((player) => player.id === from)?.resources.ore,
    ).toBe(fromOreBefore);
  });

  it("chooses phase-safe deterministic fallbacks", () => {
    let state = newGame("fallback");
    const firstAction = chooseFallbackAction(state, "player_a");
    expect(firstAction?.type).toBe("placeInitialSettlement");
    state = completeSetup(state);
    expect(chooseFallbackAction(state, "player_a")).toEqual({
      type: "rollDice",
    });
  });

  it("rejects nonempty resources on both sides of a direct trade", () => {
    const state = advanceToMain(newGame("invalid-trade"));
    const resource = singleResourceMap("grain", 1);
    fundPlayer(state, "player_a", resource);
    fundPlayer(state, "player_b", resource);

    expect(() =>
      applyPlayerTrade(state, "player_a", "player_b", resource, resource),
    ).toThrowError(RulesError);
  });
});

describe("deterministic simulation", () => {
  it("auto-advances through one hundred turns without deadlocking or losing cards", () => {
    let state = newGame("long-running-fallbacks");
    let appliedActions = 0;

    while (state.turnNumber < 100) {
      const actor = state.turn.requiredActorPlayerIds[0];
      expect(actor, `missing actor in ${state.turn.phase}`).toBeDefined();
      const action = chooseFallbackAction(state, actor!);
      expect(action, `missing fallback in ${state.turn.phase}`).not.toBeNull();
      state = applyAction(state, actor!, action!).state;
      appliedActions += 1;
      expect(appliedActions).toBeLessThan(1_000);
    }

    expect(state.version).toBe(appliedActions);
    for (const resource of [
      "brick",
      "lumber",
      "ore",
      "grain",
      "wool",
    ] as const) {
      const inHands = state.players.reduce(
        (total, player) => total + player.resources[resource],
        0,
      );
      expect(state.bank[resource] + inHands).toBe(19);
    }
  });
});
