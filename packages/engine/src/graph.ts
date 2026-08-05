import type { Board, Resource } from "@catanbench/protocol";

import { RESOURCES } from "./constants";
import type { EnginePlayer, EngineState } from "./types";

export function edgesAtVertex(board: Board, vertexId: string): Board["edges"] {
  return board.edges.filter((edge) => edge.vertexIds.includes(vertexId));
}

export function adjacentVertexIds(board: Board, vertexId: string): string[] {
  return edgesAtVertex(board, vertexId).map((edge) =>
    edge.vertexIds[0] === vertexId ? edge.vertexIds[1] : edge.vertexIds[0],
  );
}

export function getLegalInitialSettlementVertices(board: Board): string[] {
  return board.vertices
    .filter(
      (vertex) =>
        vertex.building === null &&
        adjacentVertexIds(board, vertex.id).every(
          (adjacentId) =>
            board.vertices.find((candidate) => candidate.id === adjacentId)
              ?.building === null,
        ),
    )
    .map((vertex) => vertex.id)
    .sort();
}

export function getLegalSettlementVertices(
  state: EngineState,
  playerId: string,
): string[] {
  return getLegalInitialSettlementVertices(state.board).filter((vertexId) =>
    edgesAtVertex(state.board, vertexId).some(
      (edge) => edge.roadPlayerId === playerId,
    ),
  );
}

export function getLegalInitialRoadEdges(
  board: Board,
  settlementVertexId: string,
): string[] {
  return edgesAtVertex(board, settlementVertexId)
    .filter((edge) => edge.roadPlayerId === null)
    .map((edge) => edge.id)
    .sort();
}

export function getLegalRoadEdges(
  state: EngineState,
  playerId: string,
): string[] {
  const vertexById = new Map(
    state.board.vertices.map((vertex) => [vertex.id, vertex]),
  );

  return state.board.edges
    .filter((edge) => edge.roadPlayerId === null)
    .filter((edge) =>
      edge.vertexIds.some((vertexId) => {
        const building = vertexById.get(vertexId)?.building;
        if (building !== null && building !== undefined) {
          return building.playerId === playerId;
        }

        return edgesAtVertex(state.board, vertexId).some(
          (candidate) => candidate.roadPlayerId === playerId,
        );
      }),
    )
    .map((edge) => edge.id)
    .sort();
}

export function getMaritimeRates(
  board: Board,
  playerId: string,
): Record<Resource, number> {
  const rates = Object.fromEntries(
    RESOURCES.map((resource) => [resource, 4]),
  ) as Record<Resource, number>;
  const occupiedVertexIds = new Set(
    board.vertices
      .filter((vertex) => vertex.building?.playerId === playerId)
      .map((vertex) => vertex.id),
  );

  for (const port of board.ports) {
    if (!port.vertexIds.some((vertexId) => occupiedVertexIds.has(vertexId))) {
      continue;
    }

    if (port.resource === null) {
      for (const resource of RESOURCES) {
        rates[resource] = Math.min(rates[resource], 3);
      }
    } else {
      rates[port.resource] = Math.min(rates[port.resource], 2);
    }
  }

  return rates;
}

export function getLongestRoadLength(board: Board, playerId: string): number {
  const ownedEdges = board.edges.filter(
    (edge) => edge.roadPlayerId === playerId,
  );
  const ownedEdgeIds = new Set(ownedEdges.map((edge) => edge.id));
  const buildingByVertex = new Map(
    board.vertices.map((vertex) => [vertex.id, vertex.building]),
  );
  const incidentEdges = new Map<string, Board["edges"]>();

  for (const edge of ownedEdges) {
    for (const vertexId of edge.vertexIds) {
      const current = incidentEdges.get(vertexId) ?? [];
      current.push(edge);
      incidentEdges.set(vertexId, current);
    }
  }

  function visit(vertexId: string, usedEdgeIds: ReadonlySet<string>): number {
    const building = buildingByVertex.get(vertexId);
    if (
      usedEdgeIds.size > 0 &&
      building !== null &&
      building !== undefined &&
      building.playerId !== playerId
    ) {
      return 0;
    }

    let longest = 0;
    for (const edge of incidentEdges.get(vertexId) ?? []) {
      if (!ownedEdgeIds.has(edge.id) || usedEdgeIds.has(edge.id)) {
        continue;
      }

      const nextVertexId =
        edge.vertexIds[0] === vertexId ? edge.vertexIds[1] : edge.vertexIds[0];
      const nextUsedEdges = new Set(usedEdgeIds);
      nextUsedEdges.add(edge.id);
      longest = Math.max(longest, 1 + visit(nextVertexId, nextUsedEdges));
    }

    return longest;
  }

  return Math.max(
    0,
    ...ownedEdges.flatMap((edge) =>
      edge.vertexIds.map((vertexId) => visit(vertexId, new Set())),
    ),
  );
}

function chooseAwardHolder(
  scores: ReadonlyMap<string, number>,
  currentHolder: string | null,
  minimum: number,
): { playerId: string | null; score: number } {
  const highest = Math.max(0, ...scores.values());
  if (highest < minimum) {
    return { playerId: null, score: highest };
  }

  const leaders = [...scores.entries()]
    .filter(([, score]) => score === highest)
    .map(([playerId]) => playerId);
  if (currentHolder !== null && leaders.includes(currentHolder)) {
    return { playerId: currentHolder, score: highest };
  }

  return {
    playerId: leaders.length === 1 ? leaders[0]! : null,
    score: highest,
  };
}

export function recalculateAwards(state: EngineState): void {
  const roadLengths = new Map(
    state.players.map((player) => [
      player.id,
      getLongestRoadLength(state.board, player.id),
    ]),
  );
  const longestRoad = chooseAwardHolder(
    roadLengths,
    state.awards.longestRoad.playerId,
    5,
  );
  state.awards.longestRoad = {
    playerId: longestRoad.playerId,
    length: longestRoad.score,
  };

  const armySizes = new Map(
    state.players.map((player) => [player.id, player.playedKnights]),
  );
  const largestArmy = chooseAwardHolder(
    armySizes,
    state.awards.largestArmy.playerId,
    3,
  );
  state.awards.largestArmy = {
    playerId: largestArmy.playerId,
    size: largestArmy.score,
  };
}

function buildingVictoryPoints(state: EngineState, playerId: string): number {
  return state.board.vertices.reduce((points, vertex) => {
    if (vertex.building?.playerId !== playerId) {
      return points;
    }
    return points + (vertex.building.type === "city" ? 2 : 1);
  }, 0);
}

export function getPublicVictoryPoints(
  state: EngineState,
  playerId: string,
): number {
  return (
    buildingVictoryPoints(state, playerId) +
    (state.awards.longestRoad.playerId === playerId ? 2 : 0) +
    (state.awards.largestArmy.playerId === playerId ? 2 : 0)
  );
}

export function getVictoryPoints(state: EngineState, playerId: string): number {
  const player = state.players.find((candidate) => candidate.id === playerId);
  const hiddenVictoryPoints =
    player?.developmentCards.filter((card) => card.type === "victory_point")
      .length ?? 0;
  return getPublicVictoryPoints(state, playerId) + hiddenVictoryPoints;
}

export function findPlayer(
  state: EngineState,
  playerId: string,
): EnginePlayer | undefined {
  return state.players.find((player) => player.id === playerId);
}
