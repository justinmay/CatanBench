import { z } from "zod";

const idSchema = z.string().min(1);
const countSchema = z.number().int().nonnegative();
const timestampSchema = z.string().datetime({ offset: true });

export const ResourceSchema = z.enum([
  "brick",
  "lumber",
  "ore",
  "grain",
  "wool",
]);

export const ResourceMapSchema = z.object({
  brick: countSchema,
  lumber: countSchema,
  ore: countSchema,
  grain: countSchema,
  wool: countSchema,
});

export const ResourceRatesSchema = z.object({
  brick: z.number().int().positive(),
  lumber: z.number().int().positive(),
  ore: z.number().int().positive(),
  grain: z.number().int().positive(),
  wool: z.number().int().positive(),
});

export const GameStatusSchema = z.enum([
  "lobby",
  "initial_placement",
  "active",
  "paused",
  "finished",
  "stopped",
]);

export const TurnPhaseSchema = z.enum([
  "place_initial_settlement",
  "place_initial_road",
  "roll",
  "discard",
  "move_robber",
  "main",
  "finished",
]);

export const PlayerColorSchema = z.enum(["red", "blue", "white", "orange"]);

export const TerrainSchema = z.enum([
  "hills",
  "forest",
  "mountains",
  "fields",
  "pasture",
  "desert",
]);

export const DevelopmentCardTypeSchema = z.enum([
  "knight",
  "road_building",
  "year_of_plenty",
  "monopoly",
  "victory_point",
]);

export const TradeProposalStatusSchema = z.enum([
  "open",
  "executed",
  "expired",
]);

export const RegisterAgentRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

export const RegisterAgentResponseSchema = z.object({
  gameId: idSchema,
  playerId: idSchema,
  seat: z.number().int().nonnegative(),
  color: PlayerColorSchema,
  token: z.string().min(1),
});

export const GameActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("placeInitialSettlement"), vertexId: idSchema }),
  z.object({ type: z.literal("placeInitialRoad"), edgeId: idSchema }),
  z.object({ type: z.literal("rollDice") }),
  z.object({
    type: z.literal("discardResources"),
    resources: ResourceMapSchema,
  }),
  z.object({
    type: z.literal("moveRobber"),
    hexId: idSchema,
    victimPlayerId: idSchema.nullable(),
  }),
  z.object({ type: z.literal("buildRoad"), edgeId: idSchema }),
  z.object({ type: z.literal("buildSettlement"), vertexId: idSchema }),
  z.object({ type: z.literal("upgradeCity"), vertexId: idSchema }),
  z.object({ type: z.literal("buyDevelopmentCard") }),
  z.object({ type: z.literal("playKnight") }),
  z.object({ type: z.literal("playMonopoly"), resource: ResourceSchema }),
  z.object({
    type: z.literal("playYearOfPlenty"),
    resources: z.tuple([ResourceSchema, ResourceSchema]),
  }),
  z.object({
    type: z.literal("playRoadBuilding"),
    edgeIds: z.array(idSchema).min(1).max(2),
  }),
  z.object({
    type: z.literal("maritimeTrade"),
    give: ResourceMapSchema,
    receive: ResourceMapSchema,
  }),
  z.object({ type: z.literal("endTurn") }),
]);

export const SubmitActionRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  action: GameActionSchema,
});

export const LegalActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("placeInitialSettlement"),
    vertexIds: z.array(idSchema),
  }),
  z.object({ type: z.literal("placeInitialRoad"), edgeIds: z.array(idSchema) }),
  z.object({ type: z.literal("rollDice") }),
  z.object({ type: z.literal("discardResources"), requiredCount: countSchema }),
  z.object({
    type: z.literal("moveRobber"),
    hexIds: z.array(idSchema),
    victimPlayerIds: z.array(idSchema),
  }),
  z.object({ type: z.literal("buildRoad"), edgeIds: z.array(idSchema) }),
  z.object({
    type: z.literal("buildSettlement"),
    vertexIds: z.array(idSchema),
  }),
  z.object({ type: z.literal("upgradeCity"), vertexIds: z.array(idSchema) }),
  z.object({ type: z.literal("buyDevelopmentCard") }),
  z.object({ type: z.literal("playKnight") }),
  z.object({
    type: z.literal("playMonopoly"),
    resources: z.array(ResourceSchema),
  }),
  z.object({
    type: z.literal("playYearOfPlenty"),
    resources: z.array(ResourceSchema),
  }),
  z.object({
    type: z.literal("playRoadBuilding"),
    firstEdgeIds: z.array(idSchema),
  }),
  z.object({
    type: z.literal("maritimeTrade"),
    giveRates: ResourceRatesSchema,
  }),
  z.object({ type: z.literal("endTurn") }),
]);

export const BoardSchema = z.object({
  hexes: z.array(
    z.object({
      id: idSchema,
      q: z.number().int(),
      r: z.number().int(),
      terrain: TerrainSchema,
      number: z.number().int().min(2).max(12).nullable(),
      hasRobber: z.boolean(),
    }),
  ),
  vertices: z.array(
    z.object({
      id: idSchema,
      adjacentHexIds: z.array(idSchema),
      building: z
        .object({
          playerId: idSchema,
          type: z.enum(["settlement", "city"]),
        })
        .nullable(),
    }),
  ),
  edges: z.array(
    z.object({
      id: idSchema,
      vertexIds: z.tuple([idSchema, idSchema]),
      roadPlayerId: idSchema.nullable(),
    }),
  ),
  ports: z.array(
    z.object({
      id: idSchema,
      vertexIds: z.tuple([idSchema, idSchema]),
      ratio: z.union([z.literal(2), z.literal(3)]),
      resource: ResourceSchema.nullable(),
    }),
  ),
});

export const PublicPlayerSchema = z.object({
  playerId: idSchema,
  seat: z.number().int().nonnegative(),
  name: z.string(),
  color: PlayerColorSchema,
  resourceCount: countSchema,
  developmentCardCount: countSchema,
  publicVictoryPoints: countSchema,
  playedKnights: countSchema,
  roadsRemaining: countSchema,
  settlementsRemaining: countSchema,
  citiesRemaining: countSchema,
});

export const PrivatePlayerSchema = z.object({
  playerId: idSchema,
  seat: z.number().int().nonnegative(),
  name: z.string(),
  color: PlayerColorSchema,
  resources: ResourceMapSchema,
  developmentCards: z.array(
    z.object({
      id: idSchema,
      type: DevelopmentCardTypeSchema,
      playable: z.boolean(),
    }),
  ),
  victoryPoints: countSchema,
});

export const VisibleEventSchema = z.object({
  id: idSchema,
  version: z.number().int().nonnegative(),
  type: z.string().min(1),
  createdAt: timestampSchema,
  data: z.record(z.string(), z.unknown()),
});

export const GameStateSchema = z.object({
  game: z.object({
    id: idSchema,
    status: GameStatusSchema,
    version: z.number().int().nonnegative(),
    turnNumber: countSchema,
    victoryPointsToWin: z.number().int().positive(),
    turnTimeoutSeconds: z.number().int().positive(),
    winnerPlayerId: idSchema.nullable(),
  }),
  serverTime: timestampSchema,
  turn: z
    .object({
      activePlayerId: idSchema,
      phase: TurnPhaseSchema,
      requiredActorPlayerIds: z.array(idSchema),
      startedAt: timestampSchema,
      deadlineAt: timestampSchema,
    })
    .nullable(),
  you: PrivatePlayerSchema,
  players: z.array(PublicPlayerSchema),
  bank: z.object({
    resources: ResourceMapSchema,
    developmentCardCount: countSchema,
  }),
  board: BoardSchema,
  dice: z
    .object({
      values: z.tuple([
        z.number().int().min(1).max(6),
        z.number().int().min(1).max(6),
      ]),
      total: z.number().int().min(2).max(12),
    })
    .nullable(),
  awards: z.object({
    longestRoad: z.object({
      playerId: idSchema.nullable(),
      length: countSchema,
    }),
    largestArmy: z.object({
      playerId: idSchema.nullable(),
      size: countSchema,
    }),
  }),
  legalActions: z.array(LegalActionSchema),
  recentEvents: z.array(VisibleEventSchema),
});

export const LegalActionsResponseSchema = z.object({
  gameId: idSchema,
  version: z.number().int().nonnegative(),
  phase: TurnPhaseSchema.nullable(),
  deadlineAt: timestampSchema.nullable(),
  legalActions: z.array(LegalActionSchema),
});

export const GameCommandResponseSchema = z.object({
  gameId: idSchema,
  version: z.number().int().nonnegative(),
  event: VisibleEventSchema,
});

export const PostChatMessageRequestSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
});

export const ChatMessageSchema = z.object({
  id: idSchema,
  playerId: idSchema,
  message: z.string(),
  createdAt: timestampSchema,
});

export const ChatMessagesResponseSchema = z.object({
  messages: z.array(ChatMessageSchema),
});

export const PostChatMessageResponseSchema = z.object({
  message: ChatMessageSchema,
});

export const TradeProposalSchema = z.object({
  id: idSchema,
  fromPlayerId: idSchema,
  toPlayerId: idSchema.nullable(),
  offering: ResourceMapSchema,
  requesting: ResourceMapSchema,
  status: TradeProposalStatusSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
});

export const CreateTradeProposalRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  toPlayerId: idSchema.nullable(),
  offering: ResourceMapSchema,
  requesting: ResourceMapSchema,
});

export const ExecuteTradeRequestSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  proposalId: idSchema,
});

export const CreateTradeProposalResponseSchema = z.object({
  proposal: TradeProposalSchema,
  version: z.number().int().nonnegative(),
});

export const TradeProposalsResponseSchema = z.object({
  proposals: z.array(TradeProposalSchema),
});

export const ApiErrorCodeSchema = z.enum([
  "invalid_request",
  "idempotency_conflict",
  "missing_token",
  "invalid_token",
  "not_a_participant",
  "game_not_found",
  "registration_closed",
  "game_full",
  "agent_name_taken",
  "proposal_not_found",
  "stale_state",
  "not_your_turn",
  "illegal_action",
  "proposal_closed",
  "rate_limited",
  "internal_error",
]);

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type Board = z.infer<typeof BoardSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatMessagesResponse = z.infer<typeof ChatMessagesResponseSchema>;
export type CreateTradeProposalRequest = z.infer<
  typeof CreateTradeProposalRequestSchema
>;
export type CreateTradeProposalResponse = z.infer<
  typeof CreateTradeProposalResponseSchema
>;
export type ExecuteTradeRequest = z.infer<typeof ExecuteTradeRequestSchema>;
export type DevelopmentCardType = z.infer<typeof DevelopmentCardTypeSchema>;
export type GameAction = z.infer<typeof GameActionSchema>;
export type GameCommandResponse = z.infer<typeof GameCommandResponseSchema>;
export type GameState = z.infer<typeof GameStateSchema>;
export type LegalAction = z.infer<typeof LegalActionSchema>;
export type LegalActionsResponse = z.infer<typeof LegalActionsResponseSchema>;
export type PlayerColor = z.infer<typeof PlayerColorSchema>;
export type PostChatMessageRequest = z.infer<
  typeof PostChatMessageRequestSchema
>;
export type PostChatMessageResponse = z.infer<
  typeof PostChatMessageResponseSchema
>;
export type RegisterAgentRequest = z.infer<typeof RegisterAgentRequestSchema>;
export type RegisterAgentResponse = z.infer<typeof RegisterAgentResponseSchema>;
export type Resource = z.infer<typeof ResourceSchema>;
export type ResourceMap = z.infer<typeof ResourceMapSchema>;
export type Terrain = z.infer<typeof TerrainSchema>;
export type SubmitActionRequest = z.infer<typeof SubmitActionRequestSchema>;
export type TradeProposal = z.infer<typeof TradeProposalSchema>;
export type TradeProposalsResponse = z.infer<
  typeof TradeProposalsResponseSchema
>;
export type TurnPhase = z.infer<typeof TurnPhaseSchema>;
