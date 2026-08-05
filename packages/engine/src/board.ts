import type { Board, Resource, Terrain } from "@catanbench/protocol";

import { STANDARD_NUMBER_TOKENS, STANDARD_TERRAINS } from "./constants";
import { shuffle } from "./random";

interface AxialCoordinate {
  q: number;
  r: number;
}

interface Point {
  x: number;
  y: number;
}

interface EdgeRecord {
  keys: [string, string];
  adjacentHexCount: number;
}

const HEX_DIRECTIONS: readonly AxialCoordinate[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

const CORNER_OFFSETS: readonly Point[] = [
  { x: 1, y: 1 },
  { x: 0, y: 2 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
  { x: 0, y: -2 },
  { x: 1, y: -1 },
];

const HEX_COORDINATES: readonly AxialCoordinate[] = Array.from(
  { length: 5 },
  (_, rowIndex) => rowIndex - 2,
).flatMap((r) =>
  Array.from({ length: 5 }, (_, columnIndex) => columnIndex - 2)
    .filter((q) => Math.abs(q + r) <= 2)
    .map((q) => ({ q, r })),
);

function coordinateKey(coordinate: AxialCoordinate): string {
  return `${coordinate.q},${coordinate.r}`;
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function edgeKey(first: string, second: string): string {
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function isRedNumber(number: number): boolean {
  return number === 6 || number === 8;
}

function assignNumberTokens(
  terrains: readonly Terrain[],
  shuffledTokens: readonly number[],
): Array<number | null> {
  const coordinateIndexes = new Map(
    HEX_COORDINATES.map((coordinate, index) => [
      coordinateKey(coordinate),
      index,
    ]),
  );
  const numberedIndexes = terrains
    .map((terrain, index) => (terrain === "desert" ? -1 : index))
    .filter((index) => index >= 0)
    .sort((left, right) => {
      const neighborCount = (index: number) =>
        HEX_DIRECTIONS.filter((direction) => {
          const coordinate = HEX_COORDINATES[index]!;
          return coordinateIndexes.has(
            coordinateKey({
              q: coordinate.q + direction.q,
              r: coordinate.r + direction.r,
            }),
          );
        }).length;
      return neighborCount(right) - neighborCount(left) || left - right;
    });
  const assignments = Array<number | null>(terrains.length).fill(null);
  const remaining = [...shuffledTokens];

  function canPlace(index: number, token: number): boolean {
    if (!isRedNumber(token)) {
      return true;
    }

    const coordinate = HEX_COORDINATES[index]!;
    return HEX_DIRECTIONS.every((direction) => {
      const neighborIndex = coordinateIndexes.get(
        coordinateKey({
          q: coordinate.q + direction.q,
          r: coordinate.r + direction.r,
        }),
      );
      const neighborToken =
        neighborIndex === undefined ? null : assignments[neighborIndex];
      return neighborToken == null || !isRedNumber(neighborToken);
    });
  }

  function visit(position: number): boolean {
    if (position === numberedIndexes.length) {
      return true;
    }

    const index = numberedIndexes[position]!;
    const attempted = new Set<number>();

    for (let tokenIndex = 0; tokenIndex < remaining.length; tokenIndex += 1) {
      const token = remaining[tokenIndex]!;
      if (attempted.has(token) || !canPlace(index, token)) {
        continue;
      }

      attempted.add(token);
      assignments[index] = token;
      remaining.splice(tokenIndex, 1);

      if (visit(position + 1)) {
        return true;
      }

      remaining.splice(tokenIndex, 0, token);
      assignments[index] = null;
    }

    return false;
  }

  if (!visit(0)) {
    throw new Error("Unable to produce a valid number-token layout");
  }

  return assignments;
}

export function areHexesAdjacent(
  first: AxialCoordinate,
  second: AxialCoordinate,
): boolean {
  return HEX_DIRECTIONS.some(
    (direction) =>
      first.q + direction.q === second.q && first.r + direction.r === second.r,
  );
}

export function createStandardBoard(initialRngState: number): {
  board: Board;
  rngState: number;
} {
  const terrainShuffle = shuffle(STANDARD_TERRAINS, initialRngState);
  const tokenShuffle = shuffle(STANDARD_NUMBER_TOKENS, terrainShuffle.state);
  const numbers = assignNumberTokens(
    terrainShuffle.values,
    tokenShuffle.values,
  );

  const pointByKey = new Map<string, Point>();
  const adjacentHexIdsByVertex = new Map<string, Set<string>>();
  const edgeRecords = new Map<string, EdgeRecord>();

  const hexes: Board["hexes"] = HEX_COORDINATES.map((coordinate, index) => {
    const id = `hex_${index}`;
    const terrain = terrainShuffle.values[index]!;
    const center = { x: 2 * coordinate.q + coordinate.r, y: 3 * coordinate.r };
    const cornerKeys = CORNER_OFFSETS.map((offset) => {
      const point = { x: center.x + offset.x, y: center.y + offset.y };
      const key = pointKey(point);
      pointByKey.set(key, point);
      const adjacentHexIds =
        adjacentHexIdsByVertex.get(key) ?? new Set<string>();
      adjacentHexIds.add(id);
      adjacentHexIdsByVertex.set(key, adjacentHexIds);
      return key;
    });

    for (let corner = 0; corner < cornerKeys.length; corner += 1) {
      const first = cornerKeys[corner]!;
      const second = cornerKeys[(corner + 1) % cornerKeys.length]!;
      const key = edgeKey(first, second);
      const existing = edgeRecords.get(key);
      if (existing) {
        existing.adjacentHexCount += 1;
      } else {
        edgeRecords.set(key, {
          keys: first < second ? [first, second] : [second, first],
          adjacentHexCount: 1,
        });
      }
    }

    return {
      id,
      q: coordinate.q,
      r: coordinate.r,
      terrain,
      number: numbers[index] ?? null,
      hasRobber: terrain === "desert",
    };
  });

  const sortedVertexKeys = [...pointByKey.keys()].sort((left, right) => {
    const leftPoint = pointByKey.get(left)!;
    const rightPoint = pointByKey.get(right)!;
    return leftPoint.y - rightPoint.y || leftPoint.x - rightPoint.x;
  });
  const vertexIdByKey = new Map(
    sortedVertexKeys.map((key, index) => [key, `vertex_${index}`]),
  );
  const vertices: Board["vertices"] = sortedVertexKeys.map((key) => ({
    id: vertexIdByKey.get(key)!,
    adjacentHexIds: [...(adjacentHexIdsByVertex.get(key) ?? [])].sort(),
    building: null,
  }));

  const sortedEdges = [...edgeRecords.values()].sort((left, right) => {
    const [leftFirst, leftSecond] = left.keys.map((key) =>
      Number(vertexIdByKey.get(key)!.slice("vertex_".length)),
    );
    const [rightFirst, rightSecond] = right.keys.map((key) =>
      Number(vertexIdByKey.get(key)!.slice("vertex_".length)),
    );
    return leftFirst! - rightFirst! || leftSecond! - rightSecond!;
  });
  const edges: Board["edges"] = sortedEdges.map((edge, index) => ({
    id: `edge_${index}`,
    vertexIds: [
      vertexIdByKey.get(edge.keys[0])!,
      vertexIdByKey.get(edge.keys[1])!,
    ],
    roadPlayerId: null,
  }));

  const boundaryEdges = sortedEdges
    .filter((edge) => edge.adjacentHexCount === 1)
    .sort((left, right) => {
      const midpointAngle = (edge: EdgeRecord) => {
        const first = pointByKey.get(edge.keys[0])!;
        const second = pointByKey.get(edge.keys[1])!;
        return Math.atan2(first.y + second.y, first.x + second.x);
      };
      return midpointAngle(left) - midpointAngle(right);
    });
  const portResources: Array<Resource | null> = [
    "brick",
    "lumber",
    "ore",
    "grain",
    "wool",
    null,
    null,
    null,
    null,
  ];
  const portShuffle = shuffle(portResources, tokenShuffle.state);
  const portBoundaryIndexes = [0, 3, 7, 10, 13, 17, 20, 23, 27];
  const ports: Board["ports"] = portBoundaryIndexes.map((edgeIndex, index) => {
    const edge = boundaryEdges[edgeIndex]!;
    const resource = portShuffle.values[index]!;
    return {
      id: `port_${index}`,
      vertexIds: [
        vertexIdByKey.get(edge.keys[0])!,
        vertexIdByKey.get(edge.keys[1])!,
      ],
      ratio: resource === null ? 3 : 2,
      resource,
    };
  });

  return {
    board: { hexes, vertices, edges, ports },
    rngState: portShuffle.state,
  };
}
