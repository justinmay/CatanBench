import { createGame, emptyResourceMap } from "@catanbench/engine";
import { describe, expect, it } from "vitest";

import { projectGameState, type PlayerProjectionRecord } from "./projection";

const PLAYERS = [
  { id: "player_a", seat: 0, name: "A", color: "red" as const },
  { id: "player_b", seat: 1, name: "B", color: "blue" as const },
  { id: "player_c", seat: 2, name: "C", color: "white" as const },
];
const PLAYER_ROWS: PlayerProjectionRecord[] = PLAYERS.map((player) => ({
  ...player,
  resourceCount: 0,
  developmentCardCount: 0,
  publicVictoryPoints: 0,
  playedKnights: 0,
  roadsRemaining: 15,
  settlementsRemaining: 5,
  citiesRemaining: 4,
}));
const NOW = new Date("2026-08-04T12:00:00.000Z");

describe("game state projection", () => {
  it("returns a useful private lobby view before an engine snapshot exists", () => {
    const state = projectGameState({
      game: {
        id: "game_lobby",
        status: "lobby",
        stateVersion: 0,
        turnNumber: 0,
        turnTimeoutSeconds: 20,
        victoryPointsToWin: 10,
        winnerPlayerId: null,
        turnStartedAt: null,
        turnDeadlineAt: null,
      },
      playerId: "player_a",
      players: PLAYER_ROWS,
      state: null,
      recentEvents: [],
      serverTime: NOW,
    });

    expect(state.game.status).toBe("lobby");
    expect(state.you.resources).toEqual(emptyResourceMap());
    expect(state.bank.resources.brick).toBe(19);
    expect(state.turn).toBeNull();
    expect(state.legalActions).toEqual([]);
  });

  it("shows only the caller's private cards and resources", () => {
    const engine = createGame({
      gameId: "game_active",
      seed: "projection-seed",
      players: PLAYERS,
    });
    engine.players[0]!.resources.brick = 2;
    engine.players[0]!.developmentCards.push({
      id: "dev_private",
      type: "knight",
      purchasedTurn: -1,
      played: false,
    });
    engine.players[1]!.resources.ore = 4;

    const state = projectGameState({
      game: {
        id: engine.gameId,
        status: engine.status,
        stateVersion: engine.version,
        turnNumber: engine.turnNumber,
        turnTimeoutSeconds: 20,
        victoryPointsToWin: engine.victoryPointsToWin,
        winnerPlayerId: null,
        turnStartedAt: NOW,
        turnDeadlineAt: new Date(NOW.getTime() + 20_000),
      },
      playerId: "player_a",
      players: PLAYER_ROWS,
      state: engine,
      recentEvents: [],
      serverTime: NOW,
    });

    expect(state.you.resources.brick).toBe(2);
    expect(state.you.developmentCards).toMatchObject([
      { id: "dev_private", type: "knight", playable: false },
    ]);
    expect(
      state.players.find((player) => player.playerId === "player_b"),
    ).toMatchObject({
      resourceCount: 4,
      developmentCardCount: 0,
    });
    expect(state.players[1]).not.toHaveProperty("resources");
  });
});
