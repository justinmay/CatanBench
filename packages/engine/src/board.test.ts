import { describe, expect, it } from "vitest";

import { createStandardBoard } from "./board";

function adjacent(
  first: { q: number; r: number },
  second: { q: number; r: number },
): boolean {
  const deltaQ = first.q - second.q;
  const deltaR = first.r - second.r;
  return (
    (Math.abs(deltaQ) === 1 && deltaR === 0) ||
    (Math.abs(deltaR) === 1 && deltaQ === 0) ||
    (deltaQ === 1 && deltaR === -1) ||
    (deltaQ === -1 && deltaR === 1)
  );
}

describe("standard board generation", () => {
  it("creates the complete classic board graph", () => {
    const { board } = createStandardBoard(123_456);

    expect(board.hexes).toHaveLength(19);
    expect(board.vertices).toHaveLength(54);
    expect(board.edges).toHaveLength(72);
    expect(board.ports).toHaveLength(9);
    expect(board.hexes.filter((hex) => hex.hasRobber)).toHaveLength(1);
    expect(board.hexes.find((hex) => hex.hasRobber)?.terrain).toBe("desert");

    const terrainCounts = Object.fromEntries(
      ["forest", "pasture", "fields", "hills", "mountains", "desert"].map(
        (terrain) => [
          terrain,
          board.hexes.filter((hex) => hex.terrain === terrain).length,
        ],
      ),
    );
    expect(terrainCounts).toEqual({
      forest: 4,
      pasture: 4,
      fields: 4,
      hills: 3,
      mountains: 3,
      desert: 1,
    });

    const numberCounts = board.hexes.reduce<Record<string, number>>(
      (counts, hex) => {
        if (hex.number !== null) {
          counts[hex.number] = (counts[hex.number] ?? 0) + 1;
        }
        return counts;
      },
      {},
    );
    expect(numberCounts).toEqual({
      2: 1,
      3: 2,
      4: 2,
      5: 2,
      6: 2,
      8: 2,
      9: 2,
      10: 2,
      11: 2,
      12: 1,
    });
  });

  it("never places sixes and eights next to one another", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const { board } = createStandardBoard(seed);
      const redHexes = board.hexes.filter(
        (hex) => hex.number === 6 || hex.number === 8,
      );

      for (const hex of redHexes) {
        expect(
          redHexes.some(
            (candidate) => candidate.id !== hex.id && adjacent(hex, candidate),
          ),
        ).toBe(false);
      }
    }
  });

  it("is reproducible from the same RNG state", () => {
    expect(createStandardBoard(42)).toEqual(createStandardBoard(42));
    expect(createStandardBoard(42).board.hexes).not.toEqual(
      createStandardBoard(43).board.hexes,
    );
  });
});
