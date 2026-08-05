import {
  type ApiErrorResponse,
  ApiErrorResponseSchema,
} from "@catanbench/protocol";
import { OrchestrationError } from "@catanbench/orchestrator";

type ApiErrorCode = ApiErrorResponse["error"]["code"];

export class AgentApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    options: {
      retryable?: boolean;
      details?: Record<string, unknown>;
    } = {},
  ) {
    super(message);
    this.name = "AgentApiError";
    this.code = code;
    this.status = status;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }

  toResponse(): ApiErrorResponse {
    return ApiErrorResponseSchema.parse({
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.details ? { details: this.details } : {}),
      },
    });
  }
}

export function toAgentApiError(error: unknown): AgentApiError {
  if (error instanceof AgentApiError) {
    return error;
  }
  if (error instanceof OrchestrationError) {
    switch (error.code) {
      case "game_not_found":
        return new AgentApiError("game_not_found", 404, error.message, {
          details: error.details,
        });
      case "stale_state":
        return new AgentApiError("stale_state", 409, error.message, {
          retryable: true,
          details: error.details,
        });
      case "not_your_turn":
        return new AgentApiError("not_your_turn", 409, error.message, {
          retryable: true,
          details: error.details,
        });
      case "illegal_action":
      case "invalid_game_status":
      case "invalid_game_configuration":
        return new AgentApiError("illegal_action", 409, error.message, {
          details: error.details,
        });
      case "deadline_not_due":
      case "deadline_claim_lost":
      case "invalid_snapshot":
        return new AgentApiError("internal_error", 500, error.message, {
          retryable: true,
        });
    }
  }
  return new AgentApiError(
    "internal_error",
    500,
    "The server could not complete the request",
    { retryable: true },
  );
}
