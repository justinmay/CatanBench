import {
  createTradeProposalHttp,
  getTradeProposalsHttp,
} from "@catanbench/api/http";

import { getAgentApi } from "@/server/agent-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ gameId: string }> };

export async function GET(request: Request, { params }: Context) {
  const { gameId } = await params;
  return getTradeProposalsHttp(getAgentApi(), request, gameId);
}

export async function POST(request: Request, { params }: Context) {
  const { gameId } = await params;
  return createTradeProposalHttp(getAgentApi(), request, gameId);
}
