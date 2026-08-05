import {
  CreateTradeProposalRequestSchema,
  ExecuteTradeRequestSchema,
  PostChatMessageRequestSchema,
  RegisterAgentRequestSchema,
  SubmitActionRequestSchema,
  TradeProposalStatusSchema,
} from "@catanbench/protocol";
import type { ZodType } from "zod";

import { AgentApiError, toAgentApiError } from "./errors";
import type { AgentApi, AgentApiCommandResult } from "./service";

function json(
  body: unknown,
  status = 200,
  headers?: Record<string, string>,
): Response {
  return Response.json(body, { status, headers });
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    throw new AgentApiError(
      "missing_token",
      401,
      "Send the game-scoped token as a Bearer token",
    );
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match?.[1]) {
    throw new AgentApiError(
      "invalid_token",
      401,
      "The Authorization header must use the Bearer scheme",
    );
  }
  return match[1];
}

function idempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) {
    throw new AgentApiError(
      "invalid_request",
      400,
      "An Idempotency-Key header is required for POST requests",
    );
  }
  if (key.length > 255) {
    throw new AgentApiError(
      "invalid_request",
      400,
      "The Idempotency-Key header must not exceed 255 characters",
    );
  }
  return key;
}

async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AgentApiError(
      "invalid_request",
      400,
      "The request body must be valid JSON",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AgentApiError(
      "invalid_request",
      400,
      "The request body does not match the API contract",
      {
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
    );
  }
  return parsed.data;
}

function commandResponse(result: AgentApiCommandResult): Response {
  return json(
    result.body,
    result.status,
    result.replayed ? { "Idempotency-Replayed": "true" } : undefined,
  );
}

async function handle(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    const apiError = toAgentApiError(error);
    if (apiError.status >= 500) {
      console.error(error);
    }
    return json(apiError.toResponse(), apiError.status);
  }
}

async function authenticated(api: AgentApi, request: Request, gameId: string) {
  return api.authenticate(gameId, bearerToken(request));
}

export async function registerAgentHttp(
  api: AgentApi,
  request: Request,
  gameId: string,
): Promise<Response> {
  return handle(async () =>
    commandResponse(
      await api.registerAgent(
        gameId,
        await parseBody(request, RegisterAgentRequestSchema),
        idempotencyKey(request),
      ),
    ),
  );
}

export async function getGameStateHttp(
  api: AgentApi,
  request: Request,
  gameId: string,
): Promise<Response> {
  return handle(async () =>
    json(await api.getGameState(await authenticated(api, request, gameId))),
  );
}

export async function getLegalActionsHttp(
  api: AgentApi,
  request: Request,
  gameId: string,
): Promise<Response> {
  return handle(async () =>
    json(await api.getLegalActions(await authenticated(api, request, gameId))),
  );
}

export async function submitActionHttp(
  api: AgentApi,
  request: Request,
  gameId: string,
): Promise<Response> {
  return handle(async () => {
    const agent = await authenticated(api, request, gameId);
    return commandResponse(
      await api.submitAction(
        agent,
        await parseBody(request, SubmitActionRequestSchema),
        idempotencyKey(request),
      ),
    );
  });
}

export async function getChatMessagesHttp(
  api: AgentApi,
  request: Request,
  gameId: string,
): Promise<Response> {
  return handle(async () => {
    const agent = await authenticated(api, request, gameId);
    const after = new URL(request.url).searchParams.get("after");
    return json(await api.getChatMessages(agent, after));
  });
}

export async function postChatMessageHttp(
  api: AgentApi,
  request: Request,
  gameId: string,
): Promise<Response> {
  return handle(async () => {
    const agent = await authenticated(api, request, gameId);
    return commandResponse(
      await api.postChatMessage(
        agent,
        await parseBody(request, PostChatMessageRequestSchema),
        idempotencyKey(request),
      ),
    );
  });
}

export async function getTradeProposalsHttp(
  api: AgentApi,
  request: Request,
  gameId: string,
): Promise<Response> {
  return handle(async () => {
    const agent = await authenticated(api, request, gameId);
    const rawStatus = new URL(request.url).searchParams.get("status");
    let status = null;
    if (rawStatus !== null) {
      const parsed = TradeProposalStatusSchema.safeParse(rawStatus);
      if (!parsed.success) {
        throw new AgentApiError(
          "invalid_request",
          400,
          "Trade proposal status must be open, executed, or expired",
        );
      }
      status = parsed.data;
    }
    return json(await api.getTradeProposals(agent, status));
  });
}

export async function createTradeProposalHttp(
  api: AgentApi,
  request: Request,
  gameId: string,
): Promise<Response> {
  return handle(async () => {
    const agent = await authenticated(api, request, gameId);
    return commandResponse(
      await api.createTradeProposal(
        agent,
        await parseBody(request, CreateTradeProposalRequestSchema),
        idempotencyKey(request),
      ),
    );
  });
}

export async function executeTradeHttp(
  api: AgentApi,
  request: Request,
  gameId: string,
): Promise<Response> {
  return handle(async () => {
    const agent = await authenticated(api, request, gameId);
    return commandResponse(
      await api.executeTrade(
        agent,
        await parseBody(request, ExecuteTradeRequestSchema),
        idempotencyKey(request),
      ),
    );
  });
}
