import type { AgentApi } from "./service";
import { describe, expect, it, vi } from "vitest";

import { getGameStateHttp, registerAgentHttp } from "./http";

describe("agent HTTP handlers", () => {
  it("rejects a missing bearer token with the public error envelope", async () => {
    const api = {} as AgentApi;
    const response = await getGameStateHttp(
      api,
      new Request("http://localhost/api/v1/games/game_1/state"),
      "game_1",
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "missing_token", retryable: false },
    });
  });

  it("validates JSON before invoking registration", async () => {
    const registerAgent = vi.fn();
    const api = { registerAgent } as unknown as AgentApi;
    const response = await registerAgentHttp(
      api,
      new Request("http://localhost/api/v1/games/game_1/agents/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "register-1",
        },
        body: JSON.stringify({ name: "" }),
      }),
      "game_1",
    );

    expect(response.status).toBe(400);
    expect(registerAgent).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("marks an idempotent replay in the response headers", async () => {
    const api = {
      registerAgent: vi.fn().mockResolvedValue({
        status: 201,
        replayed: true,
        body: {
          gameId: "game_1",
          playerId: "player_1",
          seat: 0,
          color: "red",
          token: "cb_agent_token",
        },
      }),
    } as unknown as AgentApi;
    const response = await registerAgentHttp(
      api,
      new Request("http://localhost/api/v1/games/game_1/agents/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "register-1",
        },
        body: JSON.stringify({ name: "Agent One" }),
      }),
      "game_1",
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
  });
});
